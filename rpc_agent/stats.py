"""Background sampler: one place that measures the machine, shared by all clients."""

from __future__ import annotations

import asyncio
import os
import platform
import subprocess
import time
from collections import deque
from typing import Any

import psutil

from .config import config

HISTORY_SIZE = 120


def _cpu_model() -> str:
    system = platform.system()
    try:
        if system == "Linux":
            with open("/proc/cpuinfo", encoding="utf-8") as fh:
                for line in fh:
                    if line.lower().startswith("model name"):
                        return line.split(":", 1)[1].strip()
        elif system == "Darwin":
            out = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=3)
            if out.stdout.strip():
                return out.stdout.strip()
        elif system == "Windows":
            import winreg  # type: ignore

            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            return str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
    except Exception:
        pass
    return platform.processor() or platform.machine() or "Unknown CPU"


def _partitions() -> list[Any]:
    parts = []
    seen = set()
    for p in psutil.disk_partitions(all=False):
        if p.mountpoint in seen:
            continue
        if "cdrom" in p.opts or p.fstype in ("", "squashfs", "tmpfs", "devtmpfs", "overlay"):
            continue
        if p.mountpoint.startswith(("/snap", "/boot/efi", "/System/Volumes/")):
            continue
        seen.add(p.mountpoint)
        parts.append(p)
    return parts


def system_info() -> dict[str, Any]:
    uname = platform.uname()
    freq = psutil.cpu_freq() if hasattr(psutil, "cpu_freq") else None
    interfaces = []
    stats = psutil.net_if_stats()
    for name, addrs in psutil.net_if_addrs().items():
        st = stats.get(name)
        entry: dict[str, Any] = {
            "name": name,
            "up": bool(st and st.isup),
            "speed": st.speed if st else 0,
            "mtu": st.mtu if st else 0,
            "ipv4": [],
            "ipv6": [],
            "mac": None,
        }
        for a in addrs:
            fam = getattr(a.family, "name", str(a.family))
            if fam == "AF_INET":
                entry["ipv4"].append(a.address)
            elif fam == "AF_INET6":
                entry["ipv6"].append(a.address.split("%")[0])
            elif fam in ("AF_LINK", "AF_PACKET") or a.family == psutil.AF_LINK:
                entry["mac"] = a.address
        interfaces.append(entry)
    disks = []
    for p in _partitions():
        try:
            u = psutil.disk_usage(p.mountpoint)
        except (PermissionError, OSError):
            continue
        disks.append({"mount": p.mountpoint, "device": p.device, "fstype": p.fstype, "total": u.total})
    users = []
    try:
        users = sorted({u.name for u in psutil.users()})
    except Exception:
        pass
    return {
        "hostname": platform.node(),
        "os": uname.system,
        "os_release": uname.release,
        "os_version": uname.version,
        "platform": platform.platform(),
        "arch": uname.machine,
        "python": platform.python_version(),
        "cpu_model": _cpu_model(),
        "cores_physical": psutil.cpu_count(logical=False),
        "cores_logical": psutil.cpu_count(logical=True),
        "cpu_max_mhz": round(freq.max) if freq and freq.max else None,
        "memory_total": psutil.virtual_memory().total,
        "swap_total": psutil.swap_memory().total,
        "boot_time": psutil.boot_time(),
        "users": users,
        "interfaces": interfaces,
        "disks": disks,
        "agent_pid": os.getpid(),
    }


class Sampler:
    def __init__(self) -> None:
        self.latest: dict[str, Any] | None = None
        self.history: deque[dict[str, Any]] = deque(maxlen=HISTORY_SIZE)
        self._cond = asyncio.Condition()
        self._prev_net = None
        self._prev_disk = None
        self._prev_t = None
        self._parts: list[Any] = []
        self._parts_at = 0.0
        self._task: asyncio.Task | None = None

    def _sample(self) -> dict[str, Any]:
        now = time.time()
        per_core = psutil.cpu_percent(percpu=True)
        cpu_total = round(sum(per_core) / len(per_core), 1) if per_core else 0.0
        freq = psutil.cpu_freq() if hasattr(psutil, "cpu_freq") else None
        vm = psutil.virtual_memory()
        sw = psutil.swap_memory()

        if now - self._parts_at > 30:
            self._parts = _partitions()
            self._parts_at = now
        disks = []
        for p in self._parts:
            try:
                u = psutil.disk_usage(p.mountpoint)
            except (PermissionError, OSError):
                continue
            disks.append({"mount": p.mountpoint, "device": p.device, "fstype": p.fstype,
                          "total": u.total, "used": u.used, "free": u.free, "percent": u.percent})

        net = psutil.net_io_counters()
        try:
            dio = psutil.disk_io_counters()
        except Exception:
            dio = None
        dt = (now - self._prev_t) if self._prev_t else None
        net_rates = {"sent_bps": 0.0, "recv_bps": 0.0}
        disk_rates = {"read_bps": 0.0, "write_bps": 0.0}
        if dt and dt > 0:
            if self._prev_net:
                net_rates = {
                    "sent_bps": max(0.0, (net.bytes_sent - self._prev_net.bytes_sent) / dt),
                    "recv_bps": max(0.0, (net.bytes_recv - self._prev_net.bytes_recv) / dt),
                }
            if self._prev_disk and dio:
                disk_rates = {
                    "read_bps": max(0.0, (dio.read_bytes - self._prev_disk.read_bytes) / dt),
                    "write_bps": max(0.0, (dio.write_bytes - self._prev_disk.write_bytes) / dt),
                }
        self._prev_net, self._prev_disk, self._prev_t = net, dio, now

        battery = None
        try:
            b = psutil.sensors_battery()
            if b:
                secs = b.secsleft if isinstance(b.secsleft, int) and b.secsleft >= 0 else None
                battery = {"percent": round(b.percent, 1), "plugged": bool(b.power_plugged), "secs_left": secs}
        except Exception:
            pass

        temps = None
        if hasattr(psutil, "sensors_temperatures"):
            try:
                raw = psutil.sensors_temperatures() or {}
                temps = []
                for chip, entries in raw.items():
                    for e in entries:
                        if e.current and e.current > 0:
                            temps.append({"label": e.label or chip, "chip": chip,
                                          "current": round(e.current, 1), "high": e.high or None})
                temps = temps[:12] or None
            except Exception:
                temps = None

        try:
            load = [round(x, 2) for x in psutil.getloadavg()]
        except Exception:
            load = None

        return {
            "ts": now,
            "cpu": {"percent": cpu_total, "per_core": per_core,
                    "freq_mhz": round(freq.current) if freq and freq.current else None, "load": load},
            "memory": {"total": vm.total, "used": vm.total - vm.available, "available": vm.available,
                       "percent": vm.percent, "swap_total": sw.total, "swap_used": sw.used, "swap_percent": sw.percent},
            "disks": disks,
            "disk_io": disk_rates,
            "net": {**net_rates, "total_sent": net.bytes_sent, "total_recv": net.bytes_recv},
            "battery": battery,
            "temps": temps,
            "uptime": now - psutil.boot_time(),
            "process_count": len(psutil.pids()),
        }

    async def _run(self) -> None:
        psutil.cpu_percent(percpu=True)  # prime
        while True:
            try:
                snap = await asyncio.to_thread(self._sample)
                self.latest = snap
                self.history.append({
                    "ts": snap["ts"], "cpu": snap["cpu"]["percent"], "mem": snap["memory"]["percent"],
                    "rx": snap["net"]["recv_bps"], "tx": snap["net"]["sent_bps"],
                    "dr": snap["disk_io"]["read_bps"], "dw": snap["disk_io"]["write_bps"],
                })
                async with self._cond:
                    self._cond.notify_all()
            except Exception as exc:  # keep sampling even if one read fails
                print(f"[stats] sample failed: {exc}")
            interval = float(config.get("stats_interval", 1.0) or 1.0)
            await asyncio.sleep(max(0.5, min(interval, 10.0)))

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None

    async def wait_next(self) -> dict[str, Any]:
        async with self._cond:
            await self._cond.wait()
        return self.latest  # type: ignore[return-value]


sampler = Sampler()
