"""Read-only optional thermal sensors. No subprocesses or monitoring dependencies."""
def temperatures():
    result = {"gpu": None, "cpu": None, "cpuLoad": None}
    try:
        import psutil
        result["cpuLoad"] = psutil.cpu_percent(interval=None)
        readings = psutil.sensors_temperatures() if hasattr(psutil, "sensors_temperatures") else {}
        for name in ("coretemp", "k10temp", "cpu_thermal"):
            values = [sensor.current for sensor in readings.get(name, []) if sensor.current is not None]
            if values:
                result["cpu"] = max(values)
                break
    except Exception:
        pass
    try:
        import torch
        import pynvml
        import comfy.model_management as mm
        device = mm.get_torch_device()
        if device.type != "cuda" or not torch.cuda.is_available():
            return result
        pynvml.nvmlInit()
        try:
            uuid = getattr(torch.cuda.get_device_properties(device), "uuid", None)
            if uuid:
                handle = pynvml.nvmlDeviceGetHandleByUUID(str(uuid))
            elif pynvml.nvmlDeviceGetCount() == 1:
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            else:
                return result  # Never report a different physical GPU's temperature.
            result["gpu"] = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
        finally:
            pynvml.nvmlShutdown()
    except Exception:
        pass
    return result

def register():
    try:
        import asyncio
        from aiohttp import web
        from server import PromptServer
        @PromptServer.instance.routes.get("/stemstudio/temperatures")
        async def thermal_status(request):
            return web.json_response(await asyncio.to_thread(temperatures))
    except ImportError:
        pass
