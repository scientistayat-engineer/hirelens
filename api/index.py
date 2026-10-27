"""HireLens backend: 4-node LangGraph pipeline powered by Groq."""
import json
import os
from pathlib import Path
from typing import List, Optional, TypedDict

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from groq import Groq
from langgraph.graph import END, StateGraph
from pydantic import BaseModel, Field

load_dotenv()
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
app = FastAPI(title="HireLens API")


# ---------- Pydantic schemas ----------
class Extracted(BaseModel):
    job_title: str = "Not specified"
    company: str = "Not specified"
    experience: str = "Not specified"
    required_skills: List[str] = []


class Classification(BaseModel):
    category: str = "Other"
    employment_type: str = "Not specified"


class SkillAnalysis(BaseModel):
    technical: List[str] = []
    soft: List[str] = []
    top3: List[dict] = Field(default_factory=list)  # [{"skill": str, "score": int}]


class AnalyzeIn(BaseModel):
    job_description: str


class MatchIn(BaseModel):
    job_description: str
    resume_text: str


# ---------- LangGraph state + helper ----------
class State(TypedDict, total=False):
    jd: str
    extracted: dict
    classification: dict
    skills: dict
    report: dict


def ask_llm(system: str, user: str) -> dict:
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(500, "GROQ_API_KEY is not set on the server.")
    client = Groq(api_key=key)
    res = client.chat.completions.create(
        model=MODEL,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system + " Reply with valid JSON only."},
            {"role": "user", "content": user},
        ],
    )
    return json.loads(res.choices[0].message.content)


# ---------- The 4 nodes ----------
def extract_node(s: State) -> State:
    data = ask_llm(
        'Extract from the job description: {"job_title": str, "company": str, '
        '"experience": str, "required_skills": [str]}. Use "Not specified" when missing.',
        s["jd"],
    )
    return {"extracted": Extracted(**data).model_dump()}


def classify_node(s: State) -> State:
    data = ask_llm(
        'Classify the job: {"category": one of AI, Web Development, Data Science, Mobile, '
        'Cyber Security, DevOps, Cloud, Design, Marketing, Other; "employment_type": '
        "Full-time, Part-time, Internship, Remote, Hybrid or On-site (combine if both apply, "
        'e.g. "Full-time, On-site")}.',
        s["jd"],
    )
    return {"classification": Classification(**data).model_dump()}


def skills_node(s: State) -> State:
    data = ask_llm(
        'Return {"technical": [str], "soft": [str], "top3": [{"skill": str, "score": int 0-100}]} '
        "where top3 are the 3 most important skills, sorted by score descending.",
        json.dumps({"jd": s["jd"], "required": s["extracted"]["required_skills"]}),
    )
    return {"skills": SkillAnalysis(**data).model_dump()}


def report_node(s: State) -> State:
    e, c, k = s["extracted"], s["classification"], s["skills"]
    summary = ask_llm(
        'Write {"summary": str (2 sentences), "interview_questions": [3 short strings], '
        '"difficulty": "Entry" | "Mid" | "Senior"} for a recruiter.',
        json.dumps({"extracted": e, "classification": c, "skills": k}),
    )
    return {"report": {**e, **c, **k, **summary}}


def build_graph():
    g = StateGraph(State)
    g.add_node("extract_info", extract_node)
    g.add_node("classify_job", classify_node)
    g.add_node("analyze_skills", skills_node)
    g.add_node("generate_report", report_node)
    g.set_entry_point("extract_info")
    g.add_edge("extract_info", "classify_job")
    g.add_edge("classify_job", "analyze_skills")
    g.add_edge("analyze_skills", "generate_report")
    g.add_edge("generate_report", END)
    return g.compile()


graph = build_graph()


def validate(text: str, label: str, min_len: int = 30) -> str:
    text = (text or "").strip()
    if not text:
        raise HTTPException(400, f"{label} is empty. Paste some text to continue.")
    if len(text) < min_len:
        raise HTTPException(400, f"{label} is too short to analyse. Add more detail.")
    return text[:8000]


# ---------- Routes ----------
@app.get("/api/health")
def health():
    return {"status": "ok", "model": MODEL}


@app.post("/api/analyze")
def analyze(body: AnalyzeIn):
    jd = validate(body.job_description, "Job description")
    try:
        out = graph.invoke({"jd": jd})
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Analysis failed: {exc}")
    return out["report"]


@app.post("/api/match")
def match(body: MatchIn):
    jd = validate(body.job_description, "Job description")
    cv = validate(body.resume_text, "Resume text")
    data = ask_llm(
        'Compare resume with job. Return {"score": int 0-100, "matched": [str], '
        '"missing": [str], "advice": str (one sentence)}.',
        json.dumps({"job": jd, "resume": cv}),
    )
    return data


# Local dev only: serve the frontend. On Vercel, /public is served by the CDN.
_public = Path(__file__).resolve().parent.parent / "public"
if _public.exists():
    app.mount("/", StaticFiles(directory=_public, html=True), name="static")