"""WhatsApp Cloud API client (Meta Graph API).

Handles the two directions of the integration:
  - Outbound: send text replies back to the user.
  - Inbound:  helpers to parse the webhook payload and download voice notes.

Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.models.enums import CanalMensagem

logger = logging.getLogger(__name__)


class WhatsAppService:
    def __init__(self) -> None:
        self.base_url = settings.whatsapp_api_base_url.rstrip("/")
        self.phone_number_id = settings.whatsapp_phone_number_id
        self.access_token = settings.whatsapp_access_token

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
        }

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, max=5))
    async def send_text(self, to: str, body: str) -> dict[str, Any]:
        """Send a plain text message to a WhatsApp user (E.164, no '+')."""
        if not self.phone_number_id or not self.access_token:
            logger.warning("WhatsApp not configured; skipping send_text to %s", to)
            return {"skipped": True}

        url = f"{self.base_url}/{self.phone_number_id}/messages"
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"preview_url": False, "body": body},
        }
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, headers=self._headers, json=payload)
            resp.raise_for_status()
            return resp.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=0.5, max=5))
    async def download_media(self, media_id: str) -> bytes:
        """Resolve a media id to its URL and download the bytes (e.g. voice note)."""
        async with httpx.AsyncClient(timeout=30) as client:
            meta = await client.get(
                f"{self.base_url}/{media_id}", headers={"Authorization": f"Bearer {self.access_token}"}
            )
            meta.raise_for_status()
            media_url = meta.json()["url"]
            media = await client.get(
                media_url, headers={"Authorization": f"Bearer {self.access_token}"}
            )
            media.raise_for_status()
            return media.content

    @staticmethod
    def parse_inbound(payload: dict[str, Any]) -> list[dict[str, Any]]:
        """Flatten a webhook payload into a list of simple message dicts.

        Each item: {wa_id, message_id, canal, text?, audio_id?}
        Returns [] for status callbacks or anything without messages.
        """
        results: list[dict[str, Any]] = []
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for msg in value.get("messages", []):
                    item: dict[str, Any] = {
                        "wa_id": msg.get("from"),
                        "message_id": msg.get("id"),
                    }
                    msg_type = msg.get("type")
                    if msg_type == "text":
                        item["canal"] = CanalMensagem.TEXTO
                        item["text"] = msg["text"]["body"]
                    elif msg_type == "audio":
                        item["canal"] = CanalMensagem.AUDIO
                        item["audio_id"] = msg["audio"]["id"]
                    else:
                        # Unsupported type (image, document, etc.) — skip for now.
                        continue
                    results.append(item)
        return results


whatsapp_service = WhatsAppService()
