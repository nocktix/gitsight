"""Capa de proveedores: protocolos OpenAI y Anthropic, errores tipificados, la key nunca filtrada
y /api/llm/test. Se simula el HTTP con httpx.MockTransport (no se sale a internet)."""

import json
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app import llm, llm_errors, llm_providers, main
from app.llm_errors import LLMError

KEY = "sk-secreta-1234567890"
MSGS = [{"role": "system", "content": "sys"}, {"role": "user", "content": "hola"}]


class Server:
    """Reemplaza httpx.post: guarda las peticiones y responde según `handler`."""

    def __init__(self, monkeypatch, handler):
        self.requests: list[httpx.Request] = []
        self.handler = handler
        transport = httpx.MockTransport(self._handle)
        monkeypatch.setattr(
            llm_providers.httpx,
            "post",
            lambda url, headers=None, json=None, timeout=None: httpx.Client(
                transport=transport
            ).post(url, headers=headers, json=json),
        )

    def _handle(self, request):
        self.requests.append(request)
        return self.handler(request)

    def body(self, i=-1):
        return json.loads(self.requests[i].content)


def ok_openai(_):
    return httpx.Response(
        200,
        json={
            "model": "m-real",
            "choices": [{"message": {"content": '{"a":1}'}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4},
        },
    )


def cfg(provider="openai", model="gpt-x", base_url=None, key=KEY):
    return llm_providers.resolve_config(provider, model, base_url, key)


# --- resolve_config -------------------------------------------------------------------------


def test_presets_fill_base_urls():
    assert cfg("groq").base_url == "https://api.groq.com/openai/v1"
    assert cfg("anthropic").base_url == "https://api.anthropic.com/v1"
    assert cfg("gemini").base_url.endswith("/v1beta/openai")


def test_custom_needs_base_url_and_ollama_no_key():
    with pytest.raises(LLMError) as exc:
        cfg("custom")
    assert exc.value.code == "llm_not_configured"
    assert cfg("custom", base_url="http://x:1/v1/", key=None).base_url == "http://x:1/v1"
    assert cfg("ollama", "llama3", key=None).api_key is None


@pytest.mark.parametrize("provider", ["openai", "anthropic", "groq"])
def test_key_is_required_except_ollama_and_custom(provider):
    with pytest.raises(LLMError) as exc:
        cfg(provider, key=None)
    assert exc.value.code == "llm_not_configured"


def test_model_required_except_openrouter_automatic():
    with pytest.raises(LLMError):
        cfg("openai", model="")
    assert cfg("openrouter", model="").model is None


def test_no_settings_uses_env_and_without_env_is_not_configured(monkeypatch):
    c = llm_providers.resolve_config(None, None, None, None)
    assert (c.provider, c.model, c.api_key) == ("openrouter", None, "sk-or-env-falsa")
    monkeypatch.delenv("OPENROUTER_API_KEY")
    with pytest.raises(LLMError) as exc:
        llm_providers.resolve_config(None, None, None, None)
    assert exc.value.code == "llm_not_configured" and "configur" in exc.value.message


def test_header_key_wins_over_env_for_openrouter():
    assert cfg("openrouter", "m", key="header-key").api_key == "header-key"
    assert cfg("openrouter", "m", key=None).api_key == "sk-or-env-falsa"


def test_bad_scheme_rejected():
    with pytest.raises(LLMError):
        cfg("custom", base_url="ftp://x")


def test_config_repr_hides_key():
    assert KEY not in repr(cfg())


# --- protocolo OpenAI -------------------------------------------------------------------------


def test_openai_request_and_response(monkeypatch):
    server = Server(monkeypatch, ok_openai)
    r = llm_providers.generate(MSGS, cfg("groq", "llama"), json_mode=True)
    req = server.requests[0]
    assert str(req.url) == "https://api.groq.com/openai/v1/chat/completions"
    assert req.headers["authorization"] == f"Bearer {KEY}"
    assert server.body()["response_format"] == {"type": "json_object"}
    assert (r.text, r.model, r.tokens_prompt, r.tokens_completion) == ('{"a":1}', "m-real", 3, 4)


def test_openrouter_sends_attribution_headers_and_ollama_no_auth(monkeypatch):
    server = Server(monkeypatch, ok_openai)
    llm_providers.generate(MSGS, cfg("openrouter", "m"))
    assert server.requests[0].headers["x-title"] == "GitSight"
    llm_providers.generate(MSGS, cfg("ollama", "llama3", key=None))
    assert "authorization" not in server.requests[1].headers


def test_json_mode_falls_back_when_endpoint_rejects_response_format(monkeypatch):
    def handler(request):
        if "response_format" in json.loads(request.content):
            return httpx.Response(400, json={"error": {"message": "response_format unsupported"}})
        return ok_openai(request)

    server = Server(monkeypatch, handler)
    r = llm_providers.generate(MSGS, cfg("custom", "m", "http://x/v1", None), json_mode=True)
    assert r.text == '{"a":1}' and len(server.requests) == 2
    assert "response_format" not in server.body()


def test_json_mode_does_not_retry_on_bad_key(monkeypatch):
    server = Server(monkeypatch, lambda r: httpx.Response(401, json={"error": "no"}))
    with pytest.raises(LLMError) as exc:
        llm_providers.generate(MSGS, cfg(), json_mode=True)
    assert exc.value.code == "invalid_api_key" and len(server.requests) == 1


# --- protocolo Anthropic ----------------------------------------------------------------------


def test_anthropic_request_and_response(monkeypatch):
    def handler(_):
        return httpx.Response(
            200,
            json={
                "model": "claude-x",
                "content": [{"type": "text", "text": "ho"}, {"type": "text", "text": "la"}],
                "usage": {"input_tokens": 5, "output_tokens": 6},
            },
        )

    server = Server(monkeypatch, handler)
    r = llm_providers.generate(MSGS, cfg("anthropic", "claude-x"), json_mode=True)
    req = server.requests[0]
    assert str(req.url) == "https://api.anthropic.com/v1/messages"
    assert req.headers["x-api-key"] == KEY and req.headers["anthropic-version"]
    body = server.body()
    assert body["system"] == "sys" and body["messages"] == [{"role": "user", "content": "hola"}]
    assert body["max_tokens"] > 0 and "response_format" not in body
    assert (r.text, r.tokens_prompt, r.tokens_completion) == ("hola", 5, 6)


# --- errores tipificados -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "status,body,code",
    [
        (401, "unauthorized", "invalid_api_key"),
        (403, "forbidden", "invalid_api_key"),
        (400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}', "invalid_api_key"),
        (402, "payment required", "no_credit_or_rate_limit"),
        (429, "slow down", "no_credit_or_rate_limit"),
        (400, '{"error":{"message":"Your credit balance is too low"}}', "no_credit_or_rate_limit"),
        (404, "no such thing", "model_not_found"),
        (400, '{"error":{"message":"x/y is not a valid model ID"}}', "model_not_found"),
        (500, "boom", "provider_error"),
    ],
)
def test_http_errors_are_typed(monkeypatch, status, body, code):
    Server(monkeypatch, lambda r: httpx.Response(status, text=body))
    with pytest.raises(LLMError) as exc:
        llm_providers.generate(MSGS, cfg(model="gpt-x"))
    assert exc.value.code == code and exc.value.model_attempted == "gpt-x"


def test_timeout_and_unreachable(monkeypatch):
    def timeout(_):
        raise httpx.ReadTimeout("t")

    Server(monkeypatch, timeout)
    with pytest.raises(LLMError) as exc:
        llm_providers.generate(MSGS, cfg())
    assert exc.value.code == "timeout"

    def down(_):
        raise httpx.ConnectError("refused")

    Server(monkeypatch, down)
    with pytest.raises(LLMError) as exc:
        llm_providers.generate(MSGS, cfg())
    assert exc.value.code == "provider_unreachable"


def test_key_is_redacted_from_provider_text(monkeypatch):
    Server(monkeypatch, lambda r: httpx.Response(401, text=f"bad key {KEY} given"))
    with pytest.raises(LLMError) as exc:
        llm_providers.generate(MSGS, cfg())
    assert KEY not in exc.value.detail and KEY not in str(exc.value)


# --- cadena Automático ---------------------------------------------------------------------------


def test_invalid_key_stops_the_automatic_chain(monkeypatch):
    calls = []

    def fake(config, s, u):
        calls.append(config.model)
        raise LLMError("invalid_api_key", model_attempted=config.model)

    monkeypatch.setattr(llm, "_call_model", fake)
    with pytest.raises(LLMError) as exc:
        llm.analyze("s", "u", config=cfg("openrouter", model=""))
    assert exc.value.code == "invalid_api_key" and len(calls) == 1


# --- endpoints ---------------------------------------------------------------------------------


@pytest.fixture
def client():
    return TestClient(main.app)


def test_llm_test_ok_sends_key_from_header_only(client, monkeypatch):
    server = Server(monkeypatch, ok_openai)
    r = client.post(
        "/api/llm/test",
        json={"provider": "openai", "model": "gpt-x"},
        headers={"X-LLM-Api-Key": KEY},
    )
    assert r.status_code == 200 and r.json()["ok"] is True and r.json()["model"] == "m-real"
    assert server.requests[0].headers["authorization"] == f"Bearer {KEY}"
    assert KEY not in r.text


def test_llm_test_invalid_key_is_typed_and_leaks_nothing(client, monkeypatch, caplog):
    Server(monkeypatch, lambda r: httpx.Response(401, text=f"Incorrect API key {KEY}"))
    with caplog.at_level(logging.DEBUG):
        r = client.post(
            "/api/llm/test",
            json={"provider": "openai", "model": "gpt-x"},
            headers={"X-LLM-Api-Key": KEY},
        )
    assert r.status_code == 401
    assert r.json()["error"] == "invalid_api_key" and r.json()["model_attempted"] == "gpt-x"
    assert KEY not in r.text and KEY not in caplog.text


def test_llm_test_without_key_is_not_configured(client):
    r = client.post("/api/llm/test", json={"provider": "openai", "model": "gpt-x"})
    assert r.status_code == 400 and r.json()["error"] == "llm_not_configured"


def test_cors_allows_the_key_header(client):
    r = client.options(
        "/api/llm/test",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-llm-api-key,content-type",
        },
    )
    assert r.status_code == 200
    assert "x-llm-api-key" in r.headers["access-control-allow-headers"].lower()


def test_analyze_without_config_and_without_env_asks_to_configure(client, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY")
    r = client.post("/api/analyze", json={"repo_url": "https://github.com/o/r"})
    assert r.status_code == 400 and r.json()["error"] == "llm_not_configured"
