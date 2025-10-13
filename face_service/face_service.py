# face_service.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
from PIL import Image
import io
import insightface

# -------------------------
# FastAPI app + CORS
# -------------------------
app = FastAPI(title="Face Service", version="1.0")

# Allow your React (5173) and Node (5000) to call this service
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5000", "http://127.0.0.1:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Load InsightFace (detector + embedder)
# - uses ONNX Runtime CPU by default (no GPU required)
# -------------------------
# Model bundle "buffalo_l" includes a strong ArcFace embedder
face_app = insightface.app.FaceAnalysis(
    name="buffalo_l",
    providers=["CPUExecutionProvider"]  # if you have a proper CUDA setup, you can use ["CUDAExecutionProvider"]
)
# ctx_id=-1 forces CPU; if you have GPU and CUDA properly installed, set ctx_id=0
face_app.prepare(ctx_id=-1)


# -------------------------
# Helpers
# -------------------------
def read_rgb(image_bytes: bytes) -> np.ndarray:
    """Decode uploaded image bytes into an RGB numpy array."""
    return np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))

def largest_face(faces):
    """Pick the largest detected face (by bbox area)."""
    return max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))


# -------------------------
# Schemas
# -------------------------
class VerifyRequest(BaseModel):
    embeddingA: list[float]
    embeddingB: list[float]
    # Optional custom threshold for cosine similarity
    threshold: float | None = None


# -------------------------
# Routes
# -------------------------
@app.get("/health")
async def health():
    return {"ok": True, "model": "insightface_arcface", "dim": 512}

@app.post("/enroll")
async def enroll(student_id: int = Form(...), selfie: UploadFile = File(...)):
    """
    Accepts multipart/form-data:
      - student_id: int
      - selfie: image/jpeg or image/png
    Returns a normalized 512-d embedding for the largest face in the image.
    """
    if selfie.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(status_code=400, detail="Unsupported image type (use JPG or PNG)")

    img_bytes = await selfie.read()
    if not img_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")

    rgb = read_rgb(img_bytes)

    # Detect face(s)
    faces = face_app.get(rgb)
    if not faces:
        raise HTTPException(status_code=400, detail="No face detected")

    # Use the largest face
    face = largest_face(faces)

    # normed_embedding is already L2-normalized (float32[512])
    emb = face.normed_embedding.astype(np.float32)

    return {
        "student_id": student_id,
        "embedding": emb.tolist(),
        "dim": int(emb.shape[0]),
        "model": "insightface_arcface"
    }

@app.post("/verify")
async def verify(req: VerifyRequest):
    """
    Compare two embeddings and return cosine similarity + match boolean.
    Default threshold (cosine) = 0.55 (tune with your data).
    """
    a = np.asarray(req.embeddingA, dtype=np.float32)
    b = np.asarray(req.embeddingB, dtype=np.float32)

    if a.shape != (512,) or b.shape != (512,):
        raise HTTPException(status_code=400, detail="Embeddings must be length-512 vectors")

    # If inputs were not normalized, normalize them (harmless if already normalized)
    def l2n(x: np.ndarray) -> np.ndarray:
        n = np.linalg.norm(x)
        return x / (n + 1e-12)

    a = l2n(a)
    b = l2n(b)

    cosine = float(np.dot(a, b))  # since both are L2-normalized, cosine = dot(a, b)
    thr = 0.55 if req.threshold is None else float(req.threshold)
    return {"cosine": cosine, "threshold": thr, "is_match": cosine >= thr}
