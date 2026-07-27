import { expect, test, describe } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import * as config from "../src/config.ts";

describe("config", () => {
  test("resolve a raiz do projeto, não a pasta src/", () => {
    expect(existsSync(`${config.BASE_DIR}/package.json`)).toBe(true);
  });

  test("lê as URLs dos dois sistemas", () => {
    expect(config.PORTAL_URL).toStartWith("https://");
    expect(config.AVA_URL).toStartWith("https://");
    // São sistemas distintos, sem SSO entre eles — confundir os dois quebra o login.
    expect(config.PORTAL_URL).not.toBe(config.AVA_URL);
  });

  test("cada alvo tem seu próprio arquivo de sessão", () => {
    expect(config.STORAGE_STATE.portal).not.toBe(config.STORAGE_STATE.ava);
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
