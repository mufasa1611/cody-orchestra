@echo off
cd /d "%~dp0.."
bun run --conditions=browser src/index.ts serve --port 4097 --print-logs --log-level DEBUG
