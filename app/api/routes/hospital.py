"""Routes used by the chatbot to access hospital data/actions."""

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.hospital import (
    AppointmentCancelRequest,
    AppointmentCreateRequest,
    ConvenioUpsertRequest,
    PatientCreateRequest,
)
from app.services.hospital_service import (
    SQLTemplateNotFilledError,
    SlotUnavailableError,
    cancel_appointment,
    create_appointment,
    create_patient,
    find_patient_by_phone,
    get_calendar_dates,
    get_calendar_doctors,
    get_calendar_slots,
    get_calendar_specialties,
    get_doctor_schedule,
    list_insurance_options,
    get_patient_appointments_by_phone,
    upsert_convenio,
)

router = APIRouter(prefix="/hospital", tags=["hospital"])


@router.get("/patients/by-phone/{telefone}")
def get_patient_by_phone(telefone: str, db: Session = Depends(get_db)) -> dict:
    """Used by chatbot to check if the patient already exists."""
    try:
        patient = find_patient_by_phone(db, telefone=telefone)
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc

    if not patient:
        return {"found": False, "patient": None}
    return {"found": True, "patient": patient}


@router.post("/patients", status_code=status.HTTP_201_CREATED)
def post_patient(
    payload: PatientCreateRequest,
    db: Session = Depends(get_db),
    patient_phone: str = Header(..., alias="X-Patient-Phone"),
) -> dict:
    """Creates a new patient record using WhatsApp phone from request header."""
    try:
        data = payload.model_dump()
        data["telefone"] = patient_phone
        return create_patient(db, data)
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc


@router.post("/insurance", status_code=status.HTTP_201_CREATED)
def post_insurance(payload: ConvenioUpsertRequest, db: Session = Depends(get_db)) -> dict:
    """Creates or updates a health insurance record (convenio)."""
    try:
        return upsert_convenio(db, payload.model_dump())
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc


@router.get("/insurance/options")
def get_insurance_options(db: Session = Depends(get_db)) -> dict:
    """Returns insurance names to present as options in WhatsApp list/buttons."""
    try:
        items = list_insurance_options(db)
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": items, "total": len(items)}


@router.post("/appointments", status_code=status.HTTP_201_CREATED)
def post_appointment(payload: AppointmentCreateRequest, db: Session = Depends(get_db)) -> dict:
    """Schedules a consultation or exam based on appointment_type."""
    try:
        return create_appointment(
            db=db,
            appointment_type=payload.appointment_type,
            patient_id=payload.patient_id,
            agenda_id=payload.agenda_id,
            status=payload.status,
        )
    except SlotUnavailableError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc


@router.post("/appointments/cancel")
def post_cancel_appointment(payload: AppointmentCancelRequest, db: Session = Depends(get_db)) -> dict:
    """Cancels a consultation or exam by updating status."""
    try:
        return cancel_appointment(
            db=db,
            appointment_type=payload.appointment_type,
            appointment_id=payload.appointment_id,
            status=payload.status,
        )
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc


@router.get("/appointments/my")
def list_my_appointments(
    appointment_type: Literal["consulta", "exame"] = Query(default="consulta"),
    patient_phone: str = Header(..., alias="X-Patient-Phone"),
    db: Session = Depends(get_db),
) -> dict:
    """Lists current scheduled appointments for the current WhatsApp patient."""
    try:
        items = get_patient_appointments_by_phone(
            db=db,
            telefone=patient_phone,
            appointment_type=appointment_type,
        )
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": items, "total": len(items)}


@router.get("/doctors/schedule")
def list_doctor_schedule(
    data: date = Query(..., description="Date used to filter agenda slots."),
    periodo: Literal["morning", "afternoon", "evening"] | None = Query(default=None),
    doctor_name: str | None = Query(default=None, alias="doctor_name"),
    specialty: str | None = Query(default=None, alias="specialty"),
    db: Session = Depends(get_db),
) -> dict:
    """Lists available agenda slots by date and optional filters."""
    try:
        schedule = get_doctor_schedule(
            db=db,
            data=data,
            periodo=periodo,
            doctor_name=doctor_name,
            specialty=specialty,
        )
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": schedule, "total": len(schedule)}


@router.get("/calendar/specialties")
def list_calendar_specialties(db: Session = Depends(get_db)) -> dict:
    """Returns specialty options for WhatsApp list/buttons."""
    try:
        items = get_calendar_specialties(db)
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": items, "total": len(items)}


@router.get("/calendar/doctors")
def list_calendar_doctors(
    specialty_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Returns doctor options (optionally filtered by specialty)."""
    try:
        items = get_calendar_doctors(db, specialty_id=specialty_id)
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": items, "total": len(items)}


@router.get("/calendar/dates")
def list_calendar_dates(
    periodo: Literal["morning", "afternoon", "evening"] | None = Query(default=None),
    specialty_id: int | None = Query(default=None),
    doctor_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Returns available dates to present as WhatsApp options."""
    try:
        items = get_calendar_dates(
            db=db,
            periodo=periodo,
            specialty_id=specialty_id,
            doctor_id=doctor_id,
        )
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": items, "total": len(items)}


@router.get("/calendar/slots")
def list_calendar_slots(
    data: date = Query(..., description="Date to list available slots."),
    periodo: Literal["morning", "afternoon", "evening"] | None = Query(default=None),
    specialty_id: int | None = Query(default=None),
    doctor_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Returns available slots to send as WhatsApp list/buttons."""
    try:
        items = get_calendar_slots(
            db=db,
            data=data,
            periodo=periodo,
            specialty_id=specialty_id,
            doctor_id=doctor_id,
        )
    except SQLTemplateNotFilledError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    return {"items": items, "total": len(items)}
