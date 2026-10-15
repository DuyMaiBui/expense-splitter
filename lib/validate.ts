import { badRequest } from "./errors";

/**
 * Request-payload validators. Each helper narrows `unknown` to a concrete type and throws a
 * `badRequest` (HTTP 400, code VALIDATION) naming the offending field, so a route handler can
 * validate its whole body in a straight line without a single `typeof` check of its own.
 */

export interface StrOptions {
  min?: number;
  max?: number;
  /** Trim before measuring and returning. Defaults to true. */
  trim?: boolean;
}

export interface IntOptions {
  min?: number;
  max?: number;
}

export interface ArrayOptions {
  min?: number;
  max?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Asserts the value is a non-array object and returns it. */
export function obj(value: unknown, field: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw badRequest(`Trường "${field}" phải là một đối tượng.`);
  }
  return value;
}

/** Asserts the value is a string, optionally trimmed and length-bounded. */
export function str(value: unknown, field: string, options: StrOptions = {}): string {
  if (typeof value !== "string") {
    throw badRequest(`Trường "${field}" phải là chuỗi.`);
  }

  const result = options.trim === false ? value : value.trim();

  if (options.min !== undefined && result.length < options.min) {
    throw badRequest(`Trường "${field}" phải có ít nhất ${options.min} ký tự.`);
  }
  if (options.max !== undefined && result.length > options.max) {
    throw badRequest(`Trường "${field}" không được vượt quá ${options.max} ký tự.`);
  }

  return result;
}

/** Asserts the value is an integer within an inclusive range. Rejects floats and NaN. */
export function int(value: unknown, field: string, options: IntOptions = {}): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`Trường "${field}" phải là số nguyên.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw badRequest(`Trường "${field}" phải lớn hơn hoặc bằng ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw badRequest(`Trường "${field}" phải nhỏ hơn hoặc bằng ${options.max}.`);
  }
  return value;
}

/**
 * Asserts the value is a parseable ISO 8601 timestamp and returns it in canonical form
 * (`Date#toISOString()`), so every stored timestamp shares one format and text ordering by
 * `spent_at` matches chronological ordering.
 */
export function isoDate(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw badRequest(`Trường "${field}" phải là chuỗi thời gian ISO 8601.`);
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw badRequest(`Trường "${field}" không phải là thời gian ISO 8601 hợp lệ.`);
  }

  return new Date(parsed).toISOString();
}

/** Asserts the value is an array of strings, optionally length-bounded. */
export function strArray(value: unknown, field: string, options: ArrayOptions = {}): string[] {
  if (!Array.isArray(value)) {
    throw badRequest(`Trường "${field}" phải là mảng.`);
  }
  if (options.min !== undefined && value.length < options.min) {
    throw badRequest(`Trường "${field}" phải có ít nhất ${options.min} phần tử.`);
  }
  if (options.max !== undefined && value.length > options.max) {
    throw badRequest(`Trường "${field}" không được vượt quá ${options.max} phần tử.`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw badRequest(`Phần tử thứ ${index + 1} của "${field}" phải là chuỗi.`);
    }
    return item;
  });
}
