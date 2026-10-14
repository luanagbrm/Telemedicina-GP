"""Pydantic schemas for chatbot-driven hospital actions."""

from datetime import date
from typing import Literal

from pydantic import BaseModel


class PatientCreateRequest(BaseModel):
    nome_completo: str
    cpf: str
    data_nascimento: date
    email: str | None = None
    carteirinha_id: str | None = None


class AppointmentCreateRequest(BaseModel):
    appointment_type: Literal["consulta", "exame"]
    patient_id: int
    agenda_id: int
    status: str = "agendada"


class AppointmentCancelRequest(BaseModel):
    appointment_type: Literal["consulta", "exame"]
    appointment_id: int
    status: str = "cancelada"


class ConvenioUpsertRequest(BaseModel):
    carteirinha_id: str
    nome: str
    data_de_expiracao: date | None = None
