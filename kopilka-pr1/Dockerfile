FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN groupadd --gid 10001 kopilka \
    && useradd --uid 10001 --gid kopilka --no-create-home kopilka \
    && install -d -o kopilka -g kopilka -m 0750 /app/data

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/
COPY static/ static/
RUN chmod -R a+rX app static
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/kopilka-start

USER kopilka
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8000') + '/api/health', timeout=3).close()"]

ENTRYPOINT ["kopilka-start"]
