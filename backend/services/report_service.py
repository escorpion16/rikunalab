"""
services/report_service.py
--------------------------
Servicio de generación de interpretación clínica usando OpenRouter.
La API key se lee desde variables de entorno (.env).
"""

import os
import httpx
from typing import Optional
from dotenv import load_dotenv

load_dotenv()


def _get_config() -> tuple[str, str, str, str]:
    return (
        os.getenv("OPENROUTER_API_KEY", ""),
        os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-chat-v3-0324"),
        os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        os.getenv("OPENROUTER_APP_NAME", "RikunaLab"),
    )


OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-chat-v3-0324")


def _build_prompt(
    risk_score: float,
    risk_label: str,
    risk_color: str,
    recommendation: str,
    xai_method: str,
    filename: str,
    processing_time_ms: float,
    module: str = "glaucoma",
) -> str:
    """
    Construye el prompt estructurado para interpretación clínica detallada.
    El módulo puede ser 'glaucoma' o 'diabetic_retinopathy'.
    """
    pct         = f"{risk_score:.1f}%"
    is_gl       = module == "glaucoma"
    method_name = "EigenCAM" if xai_method == "eigengradcam" else "Grad-CAM++"
    auroc       = "94.38%" if is_gl else "98.25%"
    sens        = "86.75%" if is_gl else "96.64%"
    spec        = "88.83%" if is_gl else "94.95%"
    dataset     = "AIROGS-light-v2 (8,000 imágenes fundus)" if is_gl else "APTOS 2019 Blindness Detection (2,929 imágenes)"
    mod_name    = "Glaucoma" if is_gl else "Retinopatía Diabética"

    anatomia_gl = (
        "disco óptico, relación copa-disco (C/D ratio), anillo neurorretiniano, "
        "capa de fibras nerviosas de la retina (RNFL) peripapilar"
    )
    anatomia_dr = (
        "polo posterior, mácula, arcadas vasculares temporales, "
        "zonas de microaneurismas, hemorragias retinianas y exudados duros"
    )

    contexto_clinico_gl = (
        "El glaucoma es la principal causa de ceguera irreversible a nivel mundial. "
        "Su diagnóstico precoz en atención primaria es crítico porque la pérdida de "
        "campo visual es irreversible. Los signos funduscópicos clave incluyen "
        "excavación aumentada del nervio óptico, adelgazamiento del anillo "
        "neurorretiniano (especialmente en el polo inferior y superior), muescas "
        "del anillo, y hemorragias en astilla. Una relación C/D >0.7 o asimetría "
        "interocular >0.2 son indicadores de sospecha clínica."
    )

    contexto_clinico_dr = (
        "La retinopatía diabética es la principal causa de ceguera en personas en "
        "edad laboral. La clasificación ETDRS distingue: No DR, RDNP leve "
        "(microaneurismas aislados), RDNP moderada (hemorragias, exudados, "
        "AMIR), RDNP severa (regla 4-2-1) y RDP (neovascularización). "
        "La clasificación binaria referible/no referible considera referible "
        "a partir de RDNP moderada, maculopatía diabética o RDP. "
        "El control glucémico (HbA1c <7%) es fundamental para la prevención."
    )

    umbral_info = (
        f"El umbral de decisión del módulo de {mod_name} "
        + (
            "fue calibrado con el dataset AIROGS-light-v2. "
            "Un estudio en The Lancet Primary Care (2026) con el mismo dataset "
            "validó un umbral de derivación de 73% en screening primario."
            if is_gl else
            "fue optimizado mediante el índice de Youden (J = Sensibilidad + "
            "Especificidad − 1), resultando en 0.6094. A este umbral se obtiene "
            f"sensibilidad de {sens} y especificidad de {spec}."
        )
    )

    return f"""Eres un asistente clínico especializado en oftalmología y medicina de screening. \
Genera una interpretación clínica DETALLADA, EXPLICATIVA y PROFESIONAL para un informe médico. \
El texto debe ser comprensible para un médico general sin formación especializada en oftalmología.

DATOS DEL ANÁLISIS:
- Sistema: RikunaLab — Plataforma de Screening Retinal con IA
- Módulo: {mod_name}
- Score de riesgo: {pct} ({risk_label})
- Nivel semántico: {risk_color} (green=bajo <30%, yellow=moderado 30-65%, red=alto >65%)
- Recomendación del sistema: "{recommendation}"
- Método XAI: {method_name}
- Archivo analizado: {filename}
- Tiempo de procesamiento: {processing_time_ms:.0f} ms
- Modelo: EfficientNet-B3 (transfer learning)
- Dataset de validación: {dataset}
- Métricas validadas: AUROC {auroc} | Sensibilidad {sens} | Especificidad {spec}
- {umbral_info}

CONTEXTO CLÍNICO RELEVANTE:
{contexto_clinico_gl if is_gl else contexto_clinico_dr}

El mapa de activación XAI ({method_name}) resalta las regiones anatómicas: \
{anatomia_gl if is_gl else anatomia_dr}.

INSTRUCCIONES DE FORMATO:
- Escribe en español médico claro, sin tecnicismos innecesarios
- SIN markdown: sin asteriscos, sin #, sin guiones de lista, sin negrita
- Usa EXACTAMENTE estas 5 secciones como encabezados en líneas independientes:

Resumen del Análisis

Interpretación del Score de Riesgo

Análisis del Mapa de Activación XAI

Rendimiento Validado del Modelo

Recomendación para el Especialista y Consideraciones Clínicas

REQUISITOS DE CONTENIDO POR SECCIÓN:

Resumen del Análisis (3-4 oraciones):
Describe qué analizó el sistema, el resultado principal, y el contexto general del screening.

Interpretación del Score de Riesgo (4-5 oraciones):
Explica qué significa específicamente un score de {pct}% para {mod_name}. \
Describe qué características morfológicas o lesiones podrían estar presentes \
en este rango de score. Menciona los umbrales clínicos del sistema (30%/65%) \
y por qué el resultado actual está donde está.

Análisis del Mapa de Activación XAI (3-4 oraciones):
Explica cómo funciona {method_name} y qué significa la distribución del mapa \
de calor para este resultado específico. Menciona en qué regiones anatómicas \
se concentra la activación y su relevancia clínica para {mod_name}.

Rendimiento Validado del Modelo (3-4 oraciones):
Contextualiza las métricas AUROC {auroc}, sensibilidad {sens} y especificidad {spec} \
con un lenguaje comprensible. Compara con el estado del arte publicado. \
Explica qué significa la sensibilidad y especificidad en términos prácticos \
para el médico general que usa el sistema.

Recomendación para el Especialista y Consideraciones Clínicas (4-5 oraciones):
Detalla la recomendación específica basada en el score obtenido. \
Indica qué información adicional debe recopilarse antes de la derivación \
({"presión intraocular, antecedentes familiares, uso de corticoides" if is_gl else "HbA1c reciente, presión arterial, duración de la diabetes, función renal"}). \
Menciona qué evaluaciones especializadas realizará el oftalmólogo \
({"tonometría, campimetría, OCT de RNFL y nervio óptico" if is_gl else "biomicroscopía con midriasis, OCT macular, angiografía si se indica"}). \
Señala una limitación relevante del screening automatizado.

Máximo 500 palabras en total. Tono profesional, informativo y útil para el médico general."""


async def generate_clinical_interpretation(
    risk_score: float,
    risk_label: str,
    risk_color: str,
    recommendation: str,
    xai_method: str,
    filename: str,
    processing_time_ms: float,
    module: str = "glaucoma",
) -> Optional[str]:
    """
    Llama a OpenRouter para generar la interpretación clínica detallada.
    Lee las variables de entorno en tiempo de ejecución.
    """
    api_key, model, base_url, app_name = _get_config()

    if not api_key or api_key == "sk-or-v1-PEGA_TU_KEY_AQUI":
        return (
            "Interpretación automática no disponible: "
            "configure OPENROUTER_API_KEY en el archivo .env del backend."
        )

    prompt = _build_prompt(
        risk_score=risk_score,
        risk_label=risk_label,
        risk_color=risk_color,
        recommendation=recommendation,
        xai_method=xai_method,
        filename=filename,
        processing_time_ms=processing_time_ms,
        module=module,
    )

    headers = {
        "Authorization":  f"Bearer {api_key}",
        "Content-Type":   "application/json",
        "HTTP-Referer":   "https://rikunalab.ai",
        "X-Title":        app_name,
    }

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Eres un asistente clínico especializado en oftalmología. "
                    "Generas interpretaciones médicas detalladas, explicativas y profesionales "
                    "en español, sin markdown, para informes de screening retinal. "
                    "Tu objetivo es que un médico general entienda el resultado y sepa "
                    "exactamente qué hacer a continuación."
                ),
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        "max_tokens":  800,
        "temperature": 0.25,
    }

    async with httpx.AsyncClient(timeout=35.0) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    return data["choices"][0]["message"]["content"]
