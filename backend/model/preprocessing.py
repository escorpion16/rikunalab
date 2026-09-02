"""
preprocessing.py
----------------
Pipeline de preprocesado para imágenes fundus oftalmológicas.

Aplica dos transformaciones estándar en la literatura:
1. CLAHE  : normaliza el contraste entre distintas cámaras fundus
2. Ben Graham : elimina gradientes de iluminación no uniforme

Estas funciones son las mismas usadas durante el entrenamiento,
garantizando consistencia entre entrenamiento e inferencia.
"""

import cv2
import numpy as np


def apply_clahe(image_rgb: np.ndarray) -> np.ndarray:
    """
    Aplica CLAHE (Contrast Limited Adaptive Histogram Equalization)
    en el canal L del espacio de color LAB.

    Trabaja en LAB para no alterar el matiz ni la saturación,
    solo el brillo local — preserva el color diagnóstico de la retina.

    Args:
        image_rgb: array uint8 (H, W, 3) en espacio RGB

    Returns:
        array uint8 (H, W, 3) en espacio RGB con contraste mejorado
    """
    lab = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2LAB)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])

    return cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)


def apply_ben_graham(image_rgb: np.ndarray, target_size: int) -> np.ndarray:
    """
    Aplica el preprocesado de Ben Graham para imágenes fundus.

    Resta una versión gaussiana borrosa de la imagen para eliminar
    gradientes de iluminación entre el centro y la periferia del fondo
    de ojo, resaltando las estructuras locales (vasos, disco óptico).

    Fórmula: resultado = 4*original - 4*blurred + 128

    Args:
        image_rgb : array uint8 (H, W, 3) en espacio RGB
        target_size: tamaño de imagen usado para calcular sigma

    Returns:
        array uint8 (H, W, 3) con iluminación normalizada
    """
    sigma = max(1, target_size // 30)
    blurred = cv2.GaussianBlur(image_rgb, (0, 0), sigma)
    result = cv2.addWeighted(image_rgb, 4, blurred, -4, 128)
    return np.clip(result, 0, 255).astype(np.uint8)


def preprocess_fundus_image(
    image_bgr: np.ndarray,
    target_size: int = 224
) -> np.ndarray:
    """
    Pipeline completo de preprocesado para una imagen fundus.

    Pasos:
        1. BGR → RGB
        2. Redimensionar a target_size x target_size
        3. CLAHE para normalizar contraste entre cámaras
        4. Ben Graham para eliminar gradientes de iluminación
        5. Normalizar a float32 en rango [0, 1]
        6. Sanear NaN/Inf (imágenes corruptas o casi negras)

    Args:
        image_bgr  : array uint8 (H, W, 3) leído con cv2 (BGR)
        target_size: resolución de salida cuadrada

    Returns:
        array float32 (H, W, 3) en rango [0, 1], espacio RGB
        Listo para convertir a tensor PyTorch.
    """
    # 1. Convertir de BGR a RGB (OpenCV lee en BGR por defecto)
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)

    # 2. Redimensionar
    image_rgb = cv2.resize(
        image_rgb,
        (target_size, target_size),
        interpolation=cv2.INTER_AREA
    )

    # 3. CLAHE
    image_rgb = apply_clahe(image_rgb)

    # 4. Ben Graham
    image_rgb = apply_ben_graham(image_rgb, target_size)

    # 5. Normalizar a [0, 1]
    image_float = image_rgb.astype(np.float32) / 255.0

    # 6. Sanear valores inválidos
    image_float = np.nan_to_num(
        image_float,
        nan=0.0,
        posinf=1.0,
        neginf=0.0
    )

    return image_float


def decode_image_bytes(image_bytes: bytes) -> np.ndarray:
    """
    Decodifica bytes de imagen (JPEG, PNG) a array NumPy BGR.

    Usado por FastAPI para procesar imágenes recibidas como
    UploadFile sin necesidad de guardarlas en disco.

    Args:
        image_bytes: contenido binario del archivo de imagen

    Returns:
        array uint8 (H, W, 3) en espacio BGR

    Raises:
        ValueError: si los bytes no corresponden a una imagen válida
    """
    np_array = np.frombuffer(image_bytes, dtype=np.uint8)
    image_bgr = cv2.imdecode(np_array, cv2.IMREAD_COLOR)

    if image_bgr is None:
        raise ValueError(
            "No se pudo decodificar la imagen. "
            "Verifica que el archivo sea JPEG o PNG válido."
        )

    return image_bgr