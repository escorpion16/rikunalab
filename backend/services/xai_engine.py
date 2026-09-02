"""
xai_engine.py
-------------
Motor de explicabilidad visual (XAI) para RikunaLab.

Principios de diseño:
1. El CAM se genera a 224×224 (resolución del modelo) — sin post-procesamiento
   que altere el resultado científico del método CAM.
2. Las visualizaciones se escalan a la resolución ORIGINAL de la imagen fundus,
   preservando el aspecto ratio natural del ojo.
3. La máscara retiniana usa un círculo inscrito detectado automáticamente,
   evitando el artefacto de cuadrado que aparece con detección de contornos
   cuando la imagen tiene reflexos o iluminación no uniforme.
4. EigenCAM es el método por defecto — no depende de gradientes, estable
   en todos los rangos de score (NRG 0% y RG 100%).
"""

import base64
import io
from typing import Literal

import cv2
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from pytorch_grad_cam import EigenCAM, GradCAMPlusPlus
from pytorch_grad_cam.utils.image import show_cam_on_image


# ---------------------------------------------------------------------------
# WRAPPER INTERNO
# ---------------------------------------------------------------------------

class _ModelWrapper(nn.Module):
    def __init__(self, model: nn.Module):
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)


# ---------------------------------------------------------------------------
# UTILIDADES DE IMAGEN
# ---------------------------------------------------------------------------

def _numpy_to_base64(image_np: np.ndarray) -> str:
    """Array NumPy (H, W, 3) uint8 RGB → base64 PNG."""
    pil = Image.fromarray(image_np.astype(np.uint8))
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    buf.seek(0)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _float_to_uint8(img: np.ndarray) -> np.ndarray:
    return (img * 255).clip(0, 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# MÁSCARA CIRCULAR ROBUSTA
# ---------------------------------------------------------------------------

def _build_circular_mask(h: int, w: int, image_float: np.ndarray) -> np.ndarray:
    """
    Detecta el disco retiniano completo y genera una máscara circular suave.

    Estrategia robusta en cascada:
    1. Umbral de brillo bajo (>10) sobre la imagen original — detecta TODO
       el tejido retiniano incluyendo bordes oscuros
    2. Morfología agresiva para rellenar vasos y huecos internos
    3. Círculo mínimo envolvente del contorno más grande → siempre circular
    4. Validación del radio: debe ser >= 35% del lado menor de la imagen
       (garantiza que cubre toda la retina, no solo el nervio óptico)
    5. Fallback geométrico: círculo centrado de radio = 46% del lado menor

    El fallback geométrico es conservador pero siempre correcto para
    imágenes fundus estándar donde el ojo ocupa ~90% del frame.

    Args:
        h, w        : dimensiones de la imagen de salida
        image_float : imagen float32 (H, W, 3) en [0,1] RGB

    Returns:
        mask float32 (H, W) con transición suave en el borde
    """
    img_u8 = (image_float * 255).astype(np.uint8)

    # ── Fallback geométrico inicial ───────────────────────────────────────────
    # Para imágenes fundus el ojo siempre ocupa ~80-95% del lado menor.
    # Este valor es correcto en la mayoría de los casos y se usa si la
    # detección automática falla o produce un resultado absurdo.
    min_side = min(h, w)
    cx_fb, cy_fb = w // 2, h // 2
    r_fb = int(min_side * 0.46)   # 46% → cubre toda la retina sin cortar

    cx, cy, radius = cx_fb, cy_fb, r_fb  # inicializar con fallback

    # ── Detección automática: umbral de brillo + morfología ───────────────────
    # Usamos el canal de máximo brillo: cualquier pixel con algún canal > 10
    # es tejido retiniano (el fondo negro puro tiene todos los canales < 5)
    bright = img_u8.max(axis=2)
    _, binary = cv2.threshold(bright, 10, 255, cv2.THRESH_BINARY)

    # Morfología agresiva: rellenar vasos oscuros, disco óptico y huecos
    # Kernel grande para no dejar "agujeros" que rompan el contorno exterior
    k_large = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))
    k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
    filled  = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k_large)
    filled  = cv2.morphologyEx(filled,  cv2.MORPH_CLOSE, k_large)
    filled  = cv2.morphologyEx(filled,  cv2.MORPH_OPEN,  k_small)

    # Tomar el contorno de mayor ÁREA — es el disco retiniano completo
    contours, _ = cv2.findContours(
        filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    if contours:
        largest = max(contours, key=cv2.contourArea)
        (cx_f, cy_f), r_f = cv2.minEnclosingCircle(largest)
        r_f = float(r_f)

        # Validar: el radio debe ser razonable para ser la retina completa
        # Mínimo 35% del lado menor (evita detectar el nervio óptico solo)
        # Máximo 55% del lado menor (la retina no puede ser más grande)
        r_min = min_side * 0.35
        r_max = min_side * 0.55

        if r_min <= r_f <= r_max:
            # Detección exitosa — usar este círculo con margen del 1%
            cx, cy, radius = int(cx_f), int(cy_f), int(r_f * 0.99)
        elif r_f > r_max:
            # El contorno es demasiado grande (imagen sin padding)
            # Usar el fallback geométrico que ya tenemos
            pass
        else:
            # Radio demasiado pequeño → detectó estructura interna
            # Intentar con umbral más permisivo (umbral=5) para imágenes oscuras
            _, binary2 = cv2.threshold(bright, 5, 255, cv2.THRESH_BINARY)
            filled2 = cv2.morphologyEx(binary2, cv2.MORPH_CLOSE, k_large)
            filled2 = cv2.morphologyEx(filled2, cv2.MORPH_CLOSE, k_large)
            contours2, _ = cv2.findContours(
                filled2, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if contours2:
                lg2 = max(contours2, key=cv2.contourArea)
                (cx2, cy2), r2 = cv2.minEnclosingCircle(lg2)
                if r_min <= float(r2) <= r_max:
                    cx, cy, radius = int(cx2), int(cy2), int(float(r2) * 0.99)
                # Si aún falla → mantener fallback geométrico

    # ── Construir máscara con feathering suave ────────────────────────────────
    # El feathering crea una transición gradual en el borde del círculo
    # evitando el corte abrupto visible como "anillo" en el heatmap
    feather = max(8, radius // 12)
    Y, X    = np.ogrid[:h, :w]
    dist    = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2).astype(np.float32)

    mask = np.clip(
        (radius + feather - dist) / (2.0 * feather),
        0.0, 1.0
    )

    return mask


# ---------------------------------------------------------------------------
# MOTOR XAI
# ---------------------------------------------------------------------------

class XAIEngine:
    """
    Motor de explicabilidad visual para RikunaLab.

    Método recomendado: EigenCAM
    - No depende de gradientes → estable en NRG (score ~0%) y RG (score ~100%)
    - Documentado como superior a GradCAM++ en EfficientNet retinal (IoU 0.563 vs 0.22)
    - Produce mapas globales que resaltan el área del nervio óptico completa

    Método alternativo: Grad-CAM++
    - Depende de gradientes de backprop
    - Más preciso en lesiones pequeñas CUANDO el score es moderado-alto (30-80%)
    - Puede producir artefactos cuando el score es ~0% o ~100%
    """

    _IMAGENET_MEAN = torch.tensor([0.485, 0.456, 0.406])
    _IMAGENET_STD  = torch.tensor([0.229, 0.224, 0.225])
    _MODEL_SIZE    = 224  # EfficientNet-B3 input size

    def __init__(self, model: nn.Module, device: str = "cuda"):
        self.model   = model
        self.device  = torch.device(device)
        self.wrapper = _ModelWrapper(model)
        self._target_layer = model.backbone.blocks[-1]

    def _to_tensor(self, image_float: np.ndarray) -> torch.Tensor:
        """float32 (H,W,3) [0,1] → tensor normalizado (1,3,H,W)."""
        t = torch.from_numpy(image_float.transpose(2, 0, 1))
        t = (t - self._IMAGENET_MEAN.view(3, 1, 1)) / self._IMAGENET_STD.view(3, 1, 1)
        return t.unsqueeze(0).to(self.device)

    def _get_cam(self, method: str):
        layers = [self._target_layer]
        if method == "gradcam++":
            return GradCAMPlusPlus(model=self.wrapper, target_layers=layers)
        return EigenCAM(model=self.wrapper, target_layers=layers)

    def analyze(
        self,
        image_float_224: np.ndarray,
        method: Literal["gradcam++", "eigengradcam"] = "eigengradcam",
        original_image: np.ndarray | None = None,
    ) -> dict:
        """
        Ejecuta el pipeline completo de análisis XAI.

        Args:
            image_float_224 : imagen preprocesada 224×224 float32 [0,1] RGB
                              (resultado del pipeline Ben Graham del InferenceService)
            method          : método CAM — 'eigengradcam' (default) o 'gradcam++'
            original_image  : imagen ORIGINAL en bytes o array BGR uint8, antes de
                              redimensionar a 224. Si se pasa, el overlay se genera
                              a esa resolución preservando el aspecto ratio.
                              Si es None, el overlay se entrega a 224×224.

        Returns:
            dict con risk_score, original_b64, heatmap_b64, overlay_b64, method
        """
        self.model.eval()

        # ── 1. Inferencia ─────────────────────────────────────────────────────
        img_tensor = self._to_tensor(image_float_224)
        with torch.no_grad():
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                logit = self.model(img_tensor)
            risk_score = float(torch.sigmoid(logit).cpu()) * 100

        # ── 2. CAM a 224×224 — sin post-procesamiento interno ─────────────────
        cam_obj       = self._get_cam(method)
        grayscale_cam = cam_obj(input_tensor=img_tensor, targets=None)[0]
        # grayscale_cam: float32 (224, 224) en [0, 1]

        # ── 3. Determinar resolución de salida ────────────────────────────────
        # Si tenemos la imagen original, escalar todo a esa resolución
        # para preservar el aspecto ratio natural del fundus
        if original_image is not None:
            if isinstance(original_image, np.ndarray):
                out_h, out_w = original_image.shape[:2]
                # Imagen original BGR → RGB float32 [0,1]
                orig_rgb   = cv2.cvtColor(original_image, cv2.COLOR_BGR2RGB)
                base_float = orig_rgb.astype(np.float32) / 255.0
            else:
                out_h, out_w = self._MODEL_SIZE, self._MODEL_SIZE
                base_float   = image_float_224
        else:
            out_h, out_w = self._MODEL_SIZE, self._MODEL_SIZE
            base_float   = image_float_224

        # Escalar el CAM a la resolución de salida
        cam_resized = cv2.resize(
            grayscale_cam, (out_w, out_h),
            interpolation=cv2.INTER_LINEAR
        )

        # Escalar también image_float_224 si la resolución difiere
        if (out_h, out_w) != (self._MODEL_SIZE, self._MODEL_SIZE):
            base_224_resized = cv2.resize(
                image_float_224, (out_w, out_h),
                interpolation=cv2.INTER_LINEAR
            )
        else:
            base_224_resized = image_float_224
            base_float       = image_float_224

        # ── 4. Normalizar CAM ─────────────────────────────────────────────────
        # El CAM ya tiene activaciones naturalmente bajas fuera de la retina
        # porque el modelo fue entrenado con Ben Graham (fondo negro).
        # NO aplicamos máscara artificial — evita el artefacto oval/circular
        # que aparece cuando las proporciones imagen_original vs 224×224 difieren.
        cam_norm = cam_resized.copy()
        cam_max  = cam_norm.max()
        if cam_max > 1e-6:
            cam_norm = cam_norm / cam_max

        # ── 5. Overlay: imagen base + heatmap ────────────────────────────────
        overlay = show_cam_on_image(
            base_float,
            cam_norm,
            use_rgb=True,
            colormap=cv2.COLORMAP_JET,
            image_weight=0.55,
        )

        # ── 6. Heatmap puro ──────────────────────────────────────────────────
        heatmap_colored = cv2.applyColorMap(
            (cam_norm * 255).astype(np.uint8),
            cv2.COLORMAP_JET
        )
        heatmap_rgb = cv2.cvtColor(heatmap_colored, cv2.COLOR_BGR2RGB)

        # ── 7. Imagen original preprocesada (224×224 con Ben Graham) ──────────
        # Se devuelve a 224×224 siempre — es la imagen que el modelo "vio"
        original_u8 = _float_to_uint8(image_float_224)

        return {
            "risk_score":   risk_score,
            "original_b64": _numpy_to_base64(original_u8),
            "heatmap_b64":  _numpy_to_base64(heatmap_rgb),
            "overlay_b64":  _numpy_to_base64(overlay),
            "method":       method,
        }