from pathlib import Path
from typing import List
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
import zipfile
import io
import json

BASE_DIR = Path(__file__).resolve().parent
TENANTS_DIR = BASE_DIR / "tenants"
TEMPLATES_DIR = BASE_DIR / "base-templates"

app = FastAPI(title="OKF MD Master Backend")

class TenantCreate(BaseModel):
    name: str
    template: str


def _tenant_path(tenant_id: str) -> Path:
    return TENANTS_DIR / tenant_id


def _zip_folder(folder: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                z.write(path, path.relative_to(folder))
    buf.seek(0)
    return buf.read()


@app.get("/api/tenants", response_model=List[str])
def list_tenants():
    if not TENANTS_DIR.exists():
        TENANTS_DIR.mkdir(parents=True, exist_ok=True)
    return [p.name for p in sorted(TENANTS_DIR.iterdir()) if p.is_dir()]


@app.post("/api/tenants")
def create_tenant(payload: TenantCreate):
    tenant_id = payload.name.strip().replace(" ", "-").lower()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant name must not be empty.")

    tenant_path = _tenant_path(tenant_id)
    template_path = TEMPLATES_DIR / payload.template

    if not template_path.exists() or not template_path.is_dir():
        raise HTTPException(status_code=404, detail=f"Template '{payload.template}' not found.")
    if tenant_path.exists():
        raise HTTPException(status_code=409, detail=f"Tenant '{tenant_id}' already exists.")

    tenant_path.mkdir(parents=True, exist_ok=False)
    for item in template_path.rglob("*"):
        target = tenant_path / item.relative_to(template_path)
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.write_bytes(item.read_bytes())

    return JSONResponse(status_code=201, content={"tenant_id": tenant_id, "template": payload.template})


@app.get("/api/tenants/{tenant_id}/bundle")
def download_bundle(tenant_id: str):
    tenant_path = _tenant_path(tenant_id)
    if not tenant_path.exists() or not tenant_path.is_dir():
        raise HTTPException(status_code=404, detail="Tenant not found.")

    bundle_bytes = _zip_folder(tenant_path)
    file_name = f"{tenant_id}_bundle.zip"
    return StreamingResponse(io.BytesIO(bundle_bytes), media_type="application/zip", headers={"Content-Disposition": f"attachment; filename=\"{file_name}\""})


@app.get("/api/tenants/{tenant_id}")
def get_tenant(tenant_id: str):
    tenant_path = _tenant_path(tenant_id)
    if not tenant_path.exists() or not tenant_path.is_dir():
        raise HTTPException(status_code=404, detail="Tenant not found.")

    files = [str(path.relative_to(tenant_path)) for path in sorted(tenant_path.rglob("*")) if path.is_file()]
    return {"tenant_id": tenant_id, "files": files}


@app.get("/")
def root():
    return {"message": "OKF MD Master FastAPI Backend is running."}
