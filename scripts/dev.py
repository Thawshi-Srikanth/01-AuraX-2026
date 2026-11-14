"""Run the native uv + Bun development servers as one managed session."""

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STOP = threading.Event()


def tool(name, common):
    found = shutil.which(name)
    if found:
        return found
    candidate = Path.home() / common / (name + (".exe" if os.name == "nt" else ""))
    if candidate.is_file():
        return str(candidate)
    raise RuntimeError(f"Install {name} before starting AURAx; see README.md.")


def choose_port(requested, preferred):
    candidates = [requested] if requested else [*range(preferred, preferred + 20), 0]
    for candidate in candidates:
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", candidate))
                return sock.getsockname()[1]
            except OSError:
                pass
    raise RuntimeError(
        f"Port {requested} is in use. Stop that server or choose another port."
    )


def acquire_lock(file):
    file.seek(0)
    try:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def record(file, **state):
    file.seek(0)
    file.truncate()
    json.dump(state, file)
    file.flush()


def spawn(command, cwd, env):
    return subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        start_new_session=os.name != "nt",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )


def stop_process(process):
    if os.name == "nt":
        if process.poll() is None:
            try:
                process.send_signal(signal.CTRL_BREAK_EVENT)
                process.wait(timeout=20)
            except (OSError, subprocess.TimeoutExpired):
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        return
    # Each child owns its process group, including reload workers and Vite children.
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        process.poll()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def healthy(url):
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            data = json.load(response)
            return (
                data.get("status") == "healthy" and data.get("service") == "AURAx API"
            )
    except (OSError, ValueError, urllib.error.URLError):
        return False


def ready(url, children):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if STOP.is_set():
            raise InterruptedError
        if any(child.poll() is not None for child in children):
            raise RuntimeError(
                "A development server exited during startup; check its log above."
            )
        if healthy(url):
            return
        STOP.wait(0.2)
    raise RuntimeError(f"The development server did not become ready: {url}")


def open_browser(url):
    try:
        if os.environ.get("WSL_DISTRO_NAME"):
            powershell = shutil.which("powershell.exe")
            if powershell:
                subprocess.run(
                    [
                        powershell,
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        f"Start-Process -FilePath '{url}'",
                    ],
                    check=True,
                    timeout=15,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                return
        webbrowser.open(url)
    except (OSError, subprocess.SubprocessError):
        print(f"Open {url} in your browser.", flush=True)


def port_argument(value):
    port = int(value)
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("Port must be between 1 and 65535")
    return port


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-port", type=port_argument)
    parser.add_argument("--frontend-port", type=port_argument)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument(
        "--skip-install", action="store_true", help="Skip the frontend dependency check"
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=ROOT / "backend/cache/native-dev"
    )
    args = parser.parse_args()
    args.cache_dir = args.cache_dir.resolve()
    args.cache_dir.mkdir(parents=True, exist_ok=True)
    children = []
    signals = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        signals.append(signal.SIGBREAK)
    for signum in signals:
        signal.signal(signum, lambda *_: STOP.set())
    with (args.cache_dir / "launcher.lock").open("a+", encoding="utf-8") as lock:
        if not acquire_lock(lock):
            lock.seek(0)
            try:
                existing = json.load(lock)
            except ValueError:
                existing = {}
            url = existing.get("url")
            if (
                url
                and existing.get("status") == "ready"
                and healthy(url + "/backend/health")
            ):
                print(f"AURAx is already running at {url}", flush=True)
                if not args.no_browser:
                    open_browser(url)
            else:
                print(
                    "AURAx is starting or stopping; check its existing terminal.",
                    flush=True,
                )
            return 0
        record(lock, status="starting")
        try:
            uv = tool("uv", ".local/bin")
            bun = tool("bun", ".bun/bin")
            env = {
                **os.environ,
                "PATH": os.pathsep.join(
                    [
                        str(Path(uv).parent),
                        str(Path(bun).parent),
                        os.environ.get("PATH", ""),
                    ]
                ),
            }
            if not args.skip_install:
                print("Checking locked frontend dependencies…", flush=True)
                install = spawn(
                    [bun, "install", "--frozen-lockfile"], ROOT / "frontend", env
                )
                children.append(install)
                while install.poll() is None:
                    if STOP.wait(0.2):
                        raise InterruptedError
                if install.returncode:
                    raise RuntimeError("Bun dependency installation failed.")
                children.remove(install)
            backend_port = choose_port(args.backend_port, 8000)
            frontend_port = choose_port(args.frontend_port, 5173)
            if backend_port == frontend_port:
                raise RuntimeError("Backend and frontend ports must be different.")
            backend_url = f"http://127.0.0.1:{backend_port}"
            frontend_url = f"http://127.0.0.1:{frontend_port}"
            data_dir = args.cache_dir / f"port-{backend_port}"
            data_dir.mkdir(parents=True, exist_ok=True)
            backend_env = {
                **env,
                "CACHE_DB_PATH": str(data_dir / "aurax.db"),
                "FITS_CACHE_DIR": str(data_dir / "fits"),
                "CORS_ORIGINS": f"{frontend_url},http://localhost:{frontend_port}",
            }
            print(f"Starting backend: {backend_url}", flush=True)
            children.append(
                spawn(
                    [
                        uv,
                        "run",
                        "--locked",
                        "uvicorn",
                        "app.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(backend_port),
                        "--reload",
                    ],
                    ROOT / "backend",
                    backend_env,
                )
            )
            ready(backend_url + "/health", children)
            frontend_env = {
                **env,
                "AURAX_BACKEND_URL": backend_url,
                "VITE_API_BASE_URL": "/backend",
            }
            children.append(
                spawn(
                    [
                        bun,
                        "--bun",
                        "run",
                        "dev",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(frontend_port),
                    ],
                    ROOT / "frontend",
                    frontend_env,
                )
            )
            ready(frontend_url + "/backend/health", children)
            record(
                lock,
                status="ready",
                url=frontend_url,
                backend_url=backend_url,
                backend_pid=children[0].pid,
                frontend_pid=children[-1].pid,
            )
            print(
                f"\nAURAx is ready: {frontend_url}\n"
                "Press Ctrl+C to stop both servers.\n",
                flush=True,
            )
            if not args.no_browser:
                open_browser(frontend_url)
            while not STOP.wait(0.3):
                if any(child.poll() is not None for child in children):
                    raise RuntimeError(
                        "A development server stopped; shutting down its companion."
                    )
            return 0
        except InterruptedError:
            return 0
        except (RuntimeError, OSError) as error:
            print(f"AURAx: {error}", file=sys.stderr, flush=True)
            return 1
        finally:
            for child in reversed(children):
                stop_process(child)
            record(lock, status="stopped")


if __name__ == "__main__":
    raise SystemExit(main())
