"""Remote PC Control agent.

Run:  python agent.py            (then open the URL it prints)
      python agent.py --help     (options: port, host, HTTPS, token rotation)
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import webbrowser


def lan_addresses() -> list[str]:
    addrs = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        addrs.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        import psutil

        for name, entries in psutil.net_if_addrs().items():
            for a in entries:
                if a.family == socket.AF_INET and not a.address.startswith(("127.", "169.254.")):
                    addrs.add(a.address)
    except Exception:
        pass
    return sorted(addrs)


def main() -> None:
    parser = argparse.ArgumentParser(description="Remote PC Control agent")
    parser.add_argument("--host", help="Interface to listen on (default from config.json, 0.0.0.0)")
    parser.add_argument("--port", type=int, help="Port (default from config.json, 8000)")
    parser.add_argument("--cert", help="TLS certificate file, to serve over HTTPS")
    parser.add_argument("--key", help="TLS private key file")
    parser.add_argument("--no-browser", action="store_true", help="Don't open a browser on start")
    parser.add_argument("--new-token", action="store_true", help="Generate a new access token and exit")
    parser.add_argument("--show-token", action="store_true", help="Print the access token and exit")
    args = parser.parse_args()

    from rpc_agent.config import config, new_token

    if args.new_token:
        config.update(token=new_token())
        print(f"New token: {config.token}")
        return
    if args.show_token:
        print(config.token)
        return

    import uvicorn

    from rpc_agent import __version__
    from rpc_agent.app import app

    host = args.host or config.get("host", "0.0.0.0")
    port = args.port or int(config.get("port", 8000))
    scheme = "https" if args.cert and args.key else "http"

    print(f"\n  Remote PC Control agent v{__version__}")
    if config.token_rotated_reason == "compromised":
        print("  ! Your old token was public (it was committed to git), so a new one was generated.")
    print(f"\n  Access token:  {config.token}")
    print("  Keep it secret: anyone with it has full control of this PC.\n")
    hosts = ["localhost"] + (lan_addresses() if host in ("0.0.0.0", "::") else [])
    for h in hosts:
        print(f"  Open:  {scheme}://{h}:{port}/")
    print()

    if not args.no_browser:
        url = f"{scheme}://localhost:{port}/#token={config.token}"
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    uvicorn.run(app, host=host, port=port, ssl_certfile=args.cert, ssl_keyfile=args.key,
                log_level="warning", ws_max_size=16 * 1024 * 1024)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
