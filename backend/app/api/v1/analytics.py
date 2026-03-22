from fastapi import APIRouter, BackgroundTasks, Request, status

from app.core.client_ip import get_client_ip
from app.services.telegram_notify import notify_activity

router = APIRouter()


@router.post("/landing", status_code=status.HTTP_204_NO_CONTENT)
async def landing_ping(request: Request, background_tasks: BackgroundTasks):
    ip = get_client_ip(request)
    background_tasks.add_task(
        notify_activity,
        "Landing page visit",
        None,
        client_ip=ip,
    )
