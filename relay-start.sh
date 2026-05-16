#!/bin/bash

# Relay Workbench Startup Script
# Manages backend (3000) and frontend (5173) servers.

PROJECT_ROOT=$(pwd)
BACKEND_PORT=3000
FRONTEND_PORT=5173

echo "🚀 Starting Relay Workbench..."

# Function to cleanup background processes on exit
cleanup() {
    echo -e "\n🛑 Shutting down servers..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}

# Trap SIGINT (Ctrl+C) and SIGTERM
trap cleanup SIGINT SIGTERM

# 1. Start Backend
echo "📡 Starting backend on port $BACKEND_PORT..."
npx tsx src/server/index.ts "$PROJECT_ROOT" $BACKEND_PORT > /dev/null 2>&1 &
BACKEND_PID=$!

# 2. Wait for backend to be ready
echo "⏳ Waiting for backend to initialize..."
for i in {1..10}; do
    if lsof -i :$BACKEND_PORT > /dev/null; then
        echo "✅ Backend is ready."
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ Backend failed to start. Check logs or port availability."
        kill $BACKEND_PID 2>/dev/null
        exit 1
    fi
    sleep 1
done

# 3. Start Frontend
echo "💻 Starting frontend on port $FRONTEND_PORT..."
pnpm dev:web --port $FRONTEND_PORT --strictPort > /dev/null 2>&1 &
FRONTEND_PID=$!

# 4. Wait for frontend
echo "⏳ Waiting for frontend..."
for i in {1..10}; do
    if lsof -i :$FRONTEND_PORT > /dev/null; then
        echo "✅ Frontend is ready."
        URL="http://localhost:$FRONTEND_PORT"
        echo -e "\n🌐 Relay Workbench available at: $URL"
        
        # Automatically open the browser
        if command -v open > /dev/null; then
            open "$URL"
        elif command -v xdg-open > /dev/null; then
            xdg-open "$URL"
        fi

        echo "   (Press Ctrl+C to stop all servers)"
        break
    fi
    if [ $i -eq 10 ]; then
        echo "❌ Frontend failed to start."
        kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
        exit 1
    fi
    sleep 1
done

# Keep script running to maintain processes
wait
