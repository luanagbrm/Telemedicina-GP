"""Service layer for hospital/chatbot database actions."""

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import hospital_sql


class SQLTemplateNotFilledError(RuntimeError):
    """Raised when a SQL template is still in TODO mode."""


class SlotUnavailableError(RuntimeError):
    """Raised when trying to book an agenda slot that is no longer available."""


def _ensure_sql_ready(query: str, query_name: str) -> str:
    clean = query.strip()
    if not clean or clean.startswith("-- TODO"):
        raise SQLTemplateNotFilledError(
            f"SQL template `{query_name}` is not filled yet. Edit app/services/hospital_sql.py."
        )
    return clean


def _rows_to_dicts(result: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in result.mappings().all()]


def _run_select(db: Session, raw_query: str, query_name: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    query = _ensure_sql_ready(raw_query, query_name)
    result = db.execute(text(query), params)
    return _rows_to_dicts(result)


def find_patient_by_phone(db: Session, telefone: str) -> dict[str, Any] | None:
    query = _ensure_sql_ready(hospital_sql.GET_PATIENT_BY_PHONE_SQL, "GET_PATIENT_BY_PHONE_SQL")
    result = db.execute(text(query), {"telefone": telefone})
    row = result.mappings().first()
    return dict(row) if row else None


def create_patient(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    query = _ensure_sql_ready(hospital_sql.CREATE_PATIENT_SQL, "CREATE_PATIENT_SQL")
    result = db.execute(text(query), payload)
    db.commit()
    return {"ok": True, "rows_affected": result.rowcount}


def upsert_convenio(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    query = _ensure_sql_ready(hospital_sql.UPSERT_CONVENIO_SQL, "UPSERT_CONVENIO_SQL")
    result = db.execute(text(query), payload)
    db.commit()
    return {"ok": True, "rows_affected": result.rowcount}


def get_convenio_by_carteirinha(db: Session, carteirinha_id: str) -> dict[str, Any] | None:
    rows = _run_select(
        db,
        hospital_sql.GET_CONVENIO_BY_CARTEIRINHA_SQL,
        "GET_CONVENIO_BY_CARTEIRINHA_SQL",
        {"carteirinha_id": carteirinha_id},
    )
    return rows[0] if rows else None


def list_insurance_options(db: Session) -> list[dict[str, Any]]:
    return _run_select(
        db,
        hospital_sql.GET_INSURANCE_OPTIONS_SQL,
        "GET_INSURANCE_OPTIONS_SQL",
        {},
    )


def create_appointment(
    db: Session,
    appointment_type: str,
    patient_id: int,
    agenda_id: int,
    status: str,
) -> dict[str, Any]:
    try:
        if appointment_type == "consulta":
            reserve_query = _ensure_sql_ready(
                hospital_sql.RESERVE_AGENDA_SQL,
                "RESERVE_AGENDA_SQL",
            )
            reserve_result = db.execute(text(reserve_query), {"agenda_id": agenda_id})
            if reserve_result.rowcount == 0:
                raise SlotUnavailableError("Selected agenda slot is unavailable.")

            insert_query = _ensure_sql_ready(hospital_sql.CREATE_CONSULTA_SQL, "CREATE_CONSULTA_SQL")
            result = db.execute(
                text(insert_query),
                {"patient_id": patient_id, "agenda_id": agenda_id, "status": status},
            )
        else:
            insert_query = _ensure_sql_ready(hospital_sql.CREATE_EXAME_SQL, "CREATE_EXAME_SQL")
            result = db.execute(
                text(insert_query),
                {"patient_id": patient_id, "agenda_id": agenda_id, "status": status},
            )

        db.commit()
        return {"ok": True, "rows_affected": result.rowcount}
    except Exception:
        db.rollback()
        raise


def cancel_appointment(
    db: Session,
    appointment_type: str,
    appointment_id: int,
    status: str,
) -> dict[str, Any]:
    try:
        if appointment_type == "consulta":
            lookup_query = _ensure_sql_ready(
                hospital_sql.GET_CONSULTA_AGENDA_ID_SQL,
                "GET_CONSULTA_AGENDA_ID_SQL",
            )
            lookup_result = db.execute(text(lookup_query), {"appointment_id": appointment_id})
            consulta_row = lookup_result.mappings().first()

            cancel_query = _ensure_sql_ready(hospital_sql.CANCEL_CONSULTA_SQL, "CANCEL_CONSULTA_SQL")
            result = db.execute(text(cancel_query), {"appointment_id": appointment_id, "status": status})

            if consulta_row and result.rowcount > 0 and status == "cancelada":
                release_query = _ensure_sql_ready(
                    hospital_sql.RELEASE_AGENDA_SQL,
                    "RELEASE_AGENDA_SQL",
                )
                db.execute(text(release_query), {"agenda_id": consulta_row["id_agenda"]})
        else:
            cancel_query = _ensure_sql_ready(hospital_sql.CANCEL_EXAME_SQL, "CANCEL_EXAME_SQL")
            result = db.execute(text(cancel_query), {"appointment_id": appointment_id, "status": status})

        db.commit()
        return {"ok": True, "rows_affected": result.rowcount}
    except Exception:
        db.rollback()
        raise


def get_doctor_schedule(
    db: Session,
    data: date,
    periodo: str | None,
    doctor_name: str | None,
    specialty: str | None,
) -> list[dict[str, Any]]:
    query = _ensure_sql_ready(hospital_sql.GET_DOCTOR_SCHEDULE_SQL, "GET_DOCTOR_SCHEDULE_SQL")
    result = db.execute(
        text(query),
        {
            "data": data,
            "periodo": periodo,
            "doctor_name": doctor_name,
            "specialty": specialty,
        },
    )
    return _rows_to_dicts(result)


def get_calendar_specialties(db: Session) -> list[dict[str, Any]]:
    return _run_select(
        db,
        hospital_sql.GET_CALENDAR_SPECIALTIES_SQL,
        "GET_CALENDAR_SPECIALTIES_SQL",
        {},
    )


def get_calendar_doctors(db: Session, specialty_id: int | None) -> list[dict[str, Any]]:
    return _run_select(
        db,
        hospital_sql.GET_CALENDAR_DOCTORS_SQL,
        "GET_CALENDAR_DOCTORS_SQL",
        {"specialty_id": specialty_id},
    )


def get_calendar_slots(
    db: Session,
    data: date,
    periodo: str | None,
    specialty_id: int | None,
    doctor_id: int | None,
) -> list[dict[str, Any]]:
    return _run_select(
        db,
        hospital_sql.GET_CALENDAR_SLOTS_SQL,
        "GET_CALENDAR_SLOTS_SQL",
        {
            "data": data,
            "periodo": periodo,
            "specialty_id": specialty_id,
            "doctor_id": doctor_id,
        },
    )


def get_calendar_dates(
    db: Session,
    periodo: str | None,
    specialty_id: int | None,
    doctor_id: int | None,
) -> list[dict[str, Any]]:
    return _run_select(
        db,
        hospital_sql.GET_CALENDAR_DATES_SQL,
        "GET_CALENDAR_DATES_SQL",
        {
            "periodo": periodo,
            "specialty_id": specialty_id,
            "doctor_id": doctor_id,
        },
    )


def get_patient_appointments_by_phone(
    db: Session,
    telefone: str,
    appointment_type: str,
) -> list[dict[str, Any]]:
    if appointment_type == "consulta":
        raw_query = hospital_sql.GET_PATIENT_CONSULTAS_BY_PHONE_SQL
        query_name = "GET_PATIENT_CONSULTAS_BY_PHONE_SQL"
    else:
        raw_query = hospital_sql.GET_PATIENT_EXAMES_BY_PHONE_SQL
        query_name = "GET_PATIENT_EXAMES_BY_PHONE_SQL"

    return _run_select(
        db,
        raw_query,
        query_name,
        {"telefone": telefone},
    )
