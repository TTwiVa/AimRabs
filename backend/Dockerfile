
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Python 패키지 설치
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 기존 프로젝트 구조 유지
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# FastAPI 실행
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]