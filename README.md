# RikunaLab

Plataforma de screening retinal con IA explicable para detección temprana de 
glaucoma y retinopatía diabética en atención primaria.

## Módulos
- **Glaucoma** — EfficientNet-B3, AUROC 94.38%, dataset AIROGS-light-v2
- **Retinopatía Diabética** — EfficientNet-B3, AUROC 98.25%, dataset APTOS 2019

## Stack
- Backend: FastAPI + PyTorch + CUDA
- Frontend: React + Vite + TypeScript
- XAI: EigenCAM + Grad-CAM++
- LLM: OpenRouter (DeepSeek)
