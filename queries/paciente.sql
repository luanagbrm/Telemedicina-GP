from database_connection import get_connection


def create_patient(
    nome: str,
    telefone: str,
    cpf: str,
    data_nascimento: str,
    email: str | None = None,
    carteirinha_id: int | None = None):

    connection = get_connection()
    cursor = connection.cursor()

    query = """
        INSERT INTO paciente
            (nome_completo, telefone, cpf, data_nascimento, email, carteirinha_id)
        VALUES
            (%s, %s, %s, %s, %s, %s);
    """

    cursor.execute(
        query,
        (nome, telefone, cpf, data_nascimento, email, carteirinha_id)
    )

    connection.commit()

    cursor.close()
    connection.close()

-- def fetch_patient_scheduled_appointments_by_cpf(cpf:str):