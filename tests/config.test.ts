import { expect, test, describe } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import * as config from "../src/config.ts";

describe("config", () => {
  test("resolve a raiz do projeto, não a pasta src/", () => {
    expect(existsSync(`${config.BASE_DIR}/package.json`)).toBe(true);
  });

  test("lê FOCUS_BASE_URL do .env", () => {
    expect(config.BASE_URL).toStartWith("https://");
  });

  test("o symlink repository aponta para o disco de estudo", () => {
    expect(existsSync(config.REPOSITORY)).toBe(true);
    expect(realpathSync(config.REPOSITORY)).toBe("/mnt/e/Marketing/Focus");
  });

  test("requireCredentials falha com mensagem útil enquanto o .env não tem login", () => {
    if (config.USER && config.PASSWORD) return; // já preenchido: nada a testar
    expect(() => config.requireCredentials()).toThrow(/FOCUS_USER/);
  });
});
