"""Verify native startup, duplicate clicks, proxying and owned-process cleanup."""

import json
import os
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def listening(port):
    with socket.socket() as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def wait_for(predicate, seconds=90):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.2)
    raise AssertionError("Development launcher condition did not become true")


def run():
    if os.name == "nt":
        raise SystemExit("Run this integration check from WSL/Linux.")
    with tempfile.TemporaryDirectory(prefix="aurax-native-check-") as temporary:
        directory = Path(temporary)
        for scenario in ["stop", "frontend-exit"]:
            cache = directory / scenario
            backend, frontend = free_port(), free_port()
            while backend == frontend:
                frontend = free_port()
            args = [
                str(ROOT / "dev"),
                "--no-browser",
                "--backend-port",
                str(backend),
                "--frontend-port",
                str(frontend),
                "--cache-dir",
                str(cache),
            ]
            with (directory / f"{scenario}.log").open("w+") as log:
                process = subprocess.Popen(
                    args,
                    cwd=ROOT,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                try:

                    def running():
                        if process.poll() is not None:
                            log.seek(0)
                            raise AssertionError(log.read())
                        try:
                            state = json.loads((cache / "launcher.lock").read_text())
                            return state.get("status") == "ready"
                        except (OSError, ValueError):
                            return False

                    wait_for(running)
                    with urllib.request.urlopen(
                        f"http://127.0.0.1:{frontend}/backend/health", timeout=5
                    ) as response:
                        assert json.load(response)["service"] == "AURAx API"
                    with urllib.request.urlopen(
                        f"http://127.0.0.1:{frontend}/", timeout=5
                    ) as response:
                        assert b'id="root"' in response.read()
                    state = json.loads((cache / "launcher.lock").read_text())
                    if scenario == "stop":
                        duplicate = subprocess.run(
                            args, cwd=ROOT, capture_output=True, text=True, timeout=30
                        )
                        assert (
                            duplicate.returncode == 0
                            and "already running" in duplicate.stdout
                        )
                        assert process.poll() is None
                        process.send_signal(signal.SIGINT)
                    else:
                        # Stop only this test's frontend process group.
                        os.killpg(state["frontend_pid"], signal.SIGTERM)
                    result = process.wait(timeout=55)
                    assert result == (0 if scenario == "stop" else 1), (
                        scenario,
                        result,
                    )
                    wait_for(
                        lambda: not listening(backend) and not listening(frontend),
                        seconds=30,
                    )
                    print(
                        f"PASS native {scenario}: startup, proxy, ports released",
                        flush=True,
                    )
                finally:
                    if process.poll() is None:
                        process.send_signal(signal.SIGTERM)
                        process.wait(timeout=55)
                    # Fallback cleanup only uses our private child-group state.
                    if (cache / "launcher.lock").exists():
                        try:
                            state = json.loads((cache / "launcher.lock").read_text())
                            for name in ["backend_pid", "frontend_pid"]:
                                if state.get(name):
                                    try:
                                        os.killpg(state[name], signal.SIGTERM)
                                    except ProcessLookupError:
                                        pass
                        except ValueError:
                            pass
        print("All native development checks passed.", flush=True)


if __name__ == "__main__":
    run()
