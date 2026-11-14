"""Exercise real Docker/Compose stacks without external astronomy archive requests.

Creates uniquely named test projects; cleanup touches only those projects and probe
files created by this run. The normal local application and its cache are untouched.
"""

import argparse
import json
import os
import re
import secrets
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def command(args, env=None):
    result = subprocess.run(
        args,
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if result.returncode:
        raise RuntimeError(f"{' '.join(args)} failed:\n{result.stdout[-9000:]}")
    return result.stdout


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def get(url, context=None):
    with urllib.request.urlopen(url, timeout=8, context=context) as response:
        return response.status, response.headers, response.read()


def wait(url, expected=None, context=None, seconds=60):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            result = get(url, context)
            if expected is None or expected(result):
                return result
        except (OSError, urllib.error.URLError) as error:
            last = error
        time.sleep(0.5)
    raise AssertionError(f"Not ready: {url}; {last}")


class Stack:
    def __init__(self, project, files, env):
        self.project = project
        self.env = env
        self.args = ["docker", "compose", "--env-file", os.devnull, "-p", project]
        for name in files:
            self.args += ["-f", name]

    def run(self, *args):
        return command([*self.args, *args], self.env)

    def up(self):
        print(f"Starting {self.project}", flush=True)
        self.run(
            "up",
            "-d",
            "--no-build",
            "--pull",
            "never",
            "--wait",
            "--wait-timeout",
            "150",
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production-only", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--image-prefix")
    parser.add_argument("--tag", default="local")
    args = parser.parse_args()
    if args.skip_build and not args.production_only:
        parser.error("--skip-build requires --production-only")
    token = f"{os.getpid()}-{secrets.token_hex(3)}"
    prefix = args.image_prefix or f"aurax-container-check-{token}"
    env = {
        **os.environ,
        "IMAGE_PREFIX": prefix,
        "IMAGE_TAG": args.tag,
        "PROD_BIND_ADDRESS": "127.0.0.1",
        "PROD_HTTP_PORT": str(port()),
        "PROD_HTTPS_PORT": str(port()),
        "DEV_BACKEND_PORT": str(port()),
        "DEV_FRONTEND_PORT": str(port()),
        "CORS_ORIGINS": "",
    }
    prod = Stack(f"aurax-check-prod-{token}", ["docker/compose.prod.yml"], env)
    dev = Stack(f"aurax-check-dev-{token}", ["docker/compose.dev.yml"], env)
    stacks = []
    probes = []
    certs = tempfile.TemporaryDirectory(prefix="aurax-container-cert-")
    try:
        config = json.loads(prod.run("config", "--format", "json"))
        assert all("build" not in s for s in config["services"].values()), (
            "Production must pull images"
        )
        assert not config["services"]["backend"].get("ports"), (
            "Production backend must stay internal"
        )
        assert all(
            v["type"] != "bind"
            for s in config["services"].values()
            for v in s.get("volumes", [])
        ), "Production must not mount source"
        dev.run("config", "--quiet")
        if not args.skip_build:
            for component in ["backend", "frontend"]:
                print(f"Building production {component}", flush=True)
                command(
                    [
                        "docker",
                        "build",
                        "--target",
                        "production",
                        "-f",
                        f"docker/{component}.Dockerfile",
                        "-t",
                        f"{prefix}-{component}:{args.tag}",
                        ".",
                    ]
                )
        stacks.append(prod)
        prod.up()
        base = f"http://127.0.0.1:{env['PROD_HTTP_PORT']}"
        for path in [
            "/",
            "/sky",
            "/images",
            "/wavelengths",
            "/compare",
            "/saved",
            "/docs",
        ]:
            status, headers, body = get(base + path)
            assert (
                status == 200
                and "text/html" in headers["Content-Type"]
                and b'id="root"' in body
            ), path
        for path in ["/health", "/backend/health"]:
            assert json.loads(get(base + path)[2])["status"] == "healthy"
        for path in ["/api/resolve?ra=10&dec=20", "/backend/api/resolve?ra=10&dec=20"]:
            assert json.loads(get(base + path)[2])["coordinates"]["ra_deg"] == 10
        for path, status in [
            ("/assets/does-not-exist.js", 404),
            ("/backend/api/resolve?ra=10&dec=91", 422),
            ("/backend/api/compare/matches/jobs/not-a-job", 404),
        ]:
            try:
                get(base + path)
                raise AssertionError(f"Expected {status}: {path}")
            except urllib.error.HTTPError as error:
                assert error.code == status, path
                if path.startswith("/backend/"):
                    assert "detail" in json.load(error)
        prod.run("exec", "-T", "frontend", "nginx", "-t")
        prod.run(
            "exec",
            "-T",
            "backend",
            "python",
            "-c",
            "import os; from pathlib import Path; assert os.getuid() != 0; "
            "Path('/data/check-persistence').write_text('ok')",
        )
        prod.run(
            "up", "-d", "--no-deps", "--force-recreate", "--pull", "never", "backend"
        )
        wait(
            base + "/backend/health", lambda r: json.loads(r[2])["status"] == "healthy"
        )
        prod.run(
            "exec",
            "-T",
            "backend",
            "python",
            "-c",
            "from pathlib import Path; "
            "assert Path('/data/check-persistence').read_text() == 'ok'",
        )
        print(
            "PASS production SPA, API prefixes, errors, non-root backend, "
            "cache persistence and backend replacement",
            flush=True,
        )

        # Test TLS with an isolated certificate, never host credentials.
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
                "-addext",
                "subjectAltName=DNS:localhost,IP:127.0.0.1",
                "-keyout",
                f"{certs.name}/privkey.pem",
                "-out",
                f"{certs.name}/fullchain.pem",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        tls_env = {
            **env,
            "TLS_CERTS_DIR": certs.name,
            "SERVER_NAME": "localhost",
            "TLS_CERTIFICATE_FILE": "/etc/letsencrypt/fullchain.pem",
            "TLS_CERTIFICATE_KEY": "/etc/letsencrypt/privkey.pem",
        }
        tls = Stack(
            prod.project, ["docker/compose.prod.yml", "docker/compose.tls.yml"], tls_env
        )
        stacks[-1] = tls
        tls.up()
        context = ssl.create_default_context(cafile=f"{certs.name}/fullchain.pem")
        secure = f"https://127.0.0.1:{env['PROD_HTTPS_PORT']}"
        assert (
            json.loads(get(secure + "/backend/health", context)[2])["status"]
            == "healthy"
        )

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, request, fp, code, msg, headers, newurl):
                return None

        try:
            urllib.request.build_opener(NoRedirect).open(base + "/images", timeout=8)
            raise AssertionError("HTTP must redirect to HTTPS")
        except urllib.error.HTTPError as error:
            assert error.code == 308
            destination = urllib.parse.urlparse(error.headers["Location"])
            assert destination.scheme == "https" and destination.port == int(
                env["PROD_HTTPS_PORT"]
            )
        tls.run("exec", "-T", "frontend", "nginx", "-t")
        print("PASS TLS certificate loading and HTTPS API routing", flush=True)

        if not args.production_only:
            print("Building development targets", flush=True)
            dev.run("build")
            stacks.append(dev)
            dev.up()
            dev_base = f"http://127.0.0.1:{env['DEV_FRONTEND_PORT']}"
            assert (
                json.loads(get(dev_base + "/backend/health")[2])["status"] == "healthy"
            )
            frontend_probe = ROOT / f"frontend/public/aurax-container-check-{token}.txt"
            backend_probe = (
                ROOT / f"backend/app/aurax_container_check_{token.replace('-', '_')}.py"
            )
            assert not frontend_probe.exists() and not backend_probe.exists()
            probes += [frontend_probe, backend_probe]
            frontend_probe.write_text("first")
            # Vite updates its public-file index asynchronously through its watcher.
            wait(dev_base + "/" + frontend_probe.name, lambda r: r[2] == b"first")
            frontend_probe.write_text("second")
            wait(dev_base + "/" + frontend_probe.name, lambda r: r[2] == b"second")
            before = re.findall(
                r"Started server process \[(\d+)\]",
                dev.run("logs", "--no-color", "backend"),
            )
            backend_probe.write_text("# Container reload probe, not an observation.\n")
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                after = re.findall(
                    r"Started server process \[(\d+)\]",
                    dev.run("logs", "--no-color", "backend"),
                )
                if len(after) > len(before):
                    break
                time.sleep(0.5)
            else:
                raise AssertionError("Backend did not reload after a source edit")
            wait(
                dev_base + "/backend/health",
                lambda r: json.loads(r[2])["status"] == "healthy",
            )
            print(
                "PASS development API proxy, source mounts and backend reload",
                flush=True,
            )
    finally:
        cleanup_errors = []
        for stack in reversed(stacks):
            try:
                stack.run("down", "--volumes", "--remove-orphans", "--timeout", "30")
            except Exception as error:
                cleanup_errors.append(str(error))
                print(f"Cleanup failed for {stack.project}: {error}", flush=True)
        for probe in probes:
            probe.unlink(missing_ok=True)
        certs.cleanup()
        if cleanup_errors and sys.exc_info()[0] is None:
            raise RuntimeError("Container cleanup did not complete")
    print("All container checks passed.", flush=True)


if __name__ == "__main__":
    main()
