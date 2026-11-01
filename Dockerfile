FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# code + saved models + saved forecasts only (raw data is not needed to SERVE the API)
COPY backend ./backend
COPY ml ./ml
COPY configs ./configs
COPY models ./models
# the built website, if present (cd frontend && npm run build)
COPY frontend/dist ./frontend/dist
ENV PORT=8000
CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
