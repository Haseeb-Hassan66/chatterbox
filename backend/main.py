import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import users_col, messages_col
from routes import auth, groups, stats
from sockets.chat import register_socket_events
from dotenv import load_dotenv
import asyncio

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")
register_socket_events(sio)

app.include_router(auth.router,   prefix="/api/auth",   tags=["Auth"])
app.include_router(groups.router, prefix="/api/groups", tags=["Groups"])
app.include_router(stats.router,  prefix="/api/stats",  tags=["Stats"])

@app.on_event("startup")
async def create_indexes():
    await users_col.create_index("username", unique=True)
    await messages_col.create_index([("groupId", 1), ("createdAt", -1)])
    await messages_col.create_index("expiresAt", expireAfterSeconds=0)
    await messages_col.create_index([("content", "text")])
    print("Indexes created successfully")

combined_app = socketio.ASGIApp(sio, app)