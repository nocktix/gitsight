import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LANGUAGE, LANGUAGES, languageLabel, readLanguage, writeLanguage } from "../src/utils/language.ts";
import { fakeLocalStorage } from "./fakeBackend.ts";

test("ofrece solo español e inglés", () => {
  assert.deepEqual(
    LANGUAGES.map((l) => [l.code, l.label]),
    [["es", "Español"], ["en", "English"]],
  );
});

test("sin nada guardado, el idioma es español", () => {
  fakeLocalStorage({});
  assert.equal(DEFAULT_LANGUAGE, "es");
  assert.equal(readLanguage(), "es");
});

test("lo escrito se vuelve a leer", () => {
  const data = fakeLocalStorage({});
  writeLanguage("en");
  assert.equal(data.get("tid.language"), "en");
  assert.equal(readLanguage(), "en");
});

test("un valor dañado o desconocido vuelve a español", () => {
  const data = fakeLocalStorage({});
  data.set("tid.language", "fr");
  assert.equal(readLanguage(), "es");
  data.set("tid.language", "pt");
  assert.equal(readLanguage(), "es");
  data.set("tid.language", "{roto");
  assert.equal(readLanguage(), "es");
});

test("sin localStorage disponible no se rompe", () => {
  const broken = () => {
    throw new Error("bloqueado");
  };
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: broken, setItem: broken, removeItem: broken };
  assert.equal(readLanguage(), "es");
  assert.doesNotThrow(() => writeLanguage("en"));
});

test("languageLabel", () => {
  assert.equal(languageLabel("en"), "English");
});
