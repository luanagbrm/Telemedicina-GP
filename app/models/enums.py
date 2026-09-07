"""Domain enumerations — alinhadas ao modelo ER do time (Lucidchart)."""

import enum


class Perfil(str, enum.Enum):
    """Perfis de acesso ao painel administrativo (não são os pacientes do WhatsApp)."""

    ADMINISTRADOR = "ADMINISTRADOR"
    ATENDENTE = "ATENDENTE"


class StatusHorario(str, enum.Enum):
    """status_horario de um slot da Agenda."""

    DISPONIVEL = "DISPONIVEL"
    OCUPADO = "OCUPADO"
    BLOQUEADO = "BLOQUEADO"


class StatusConsulta(str, enum.Enum):
    """status_consulta."""

    AGENDADA = "AGENDADA"
    CANCELADA = "CANCELADA"
    REALIZADA = "REALIZADA"
    NAO_COMPARECEU = "NAO_COMPARECEU"


class StatusExame(str, enum.Enum):
    """status_exame de um agendamento de exame."""

    AGENDADO = "AGENDADO"
    CANCELADO = "CANCELADO"
    REALIZADO = "REALIZADO"
    NAO_COMPARECEU = "NAO_COMPARECEU"


class CanalMensagem(str, enum.Enum):
    """Como a solicitação chegou pelo WhatsApp (enviar por texto / por áudio)."""

    TEXTO = "TEXTO"
    AUDIO = "AUDIO"


class IntencaoChatbot(str, enum.Enum):
    """Intenções que a IA extrai da solicitação do usuário (ator IA no diagrama)."""

    AGENDAR_CONSULTA = "AGENDAR_CONSULTA"
    CANCELAR_CONSULTA = "CANCELAR_CONSULTA"
    REMARCAR_CONSULTA = "REMARCAR_CONSULTA"
    AGENDAR_EXAME = "AGENDAR_EXAME"
    CANCELAR_EXAME = "CANCELAR_EXAME"
    LOCALIZAR_CONSULTA = "LOCALIZAR_CONSULTA"
    CONSULTAR_DISPONIBILIDADE = "CONSULTAR_DISPONIBILIDADE"
    CHECAR_INFO_HOSPITAL = "CHECAR_INFO_HOSPITAL"
    ENCAMINHAR_HUMANO = "ENCAMINHAR_HUMANO"  # risco #1: fora da base -> atendente humano
    DESCONHECIDA = "DESCONHECIDA"


class AcaoAuditoria(str, enum.Enum):
    """Trilha leve para o painel admin e conformidade LGPD (risco #3)."""

    AGENDOU_CONSULTA = "AGENDOU_CONSULTA"
    CANCELOU_CONSULTA = "CANCELOU_CONSULTA"
    REMARCOU_CONSULTA = "REMARCOU_CONSULTA"
    AGENDOU_EXAME = "AGENDOU_EXAME"
    CANCELOU_EXAME = "CANCELOU_EXAME"
    CONSULTOU_DISPONIBILIDADE = "CONSULTOU_DISPONIBILIDADE"
    ENCAMINHOU_HUMANO = "ENCAMINHOU_HUMANO"
    LOGIN = "LOGIN"
    LOGOUT = "LOGOUT"
