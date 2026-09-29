"""Closed Pandas catalog for profiling and analysis.

Operations dispatch on a fixed name. This module does not run generated code.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Callable

import pandas as pd

SAMPLE_LIMIT = 3
OPERATIONS = {"aggregate", "trend", "detail"}
AGGREGATIONS = {"sum", "mean", "count", "min", "max"}
NUMERIC_AGGREGATIONS = {"sum", "mean", "min", "max"}
FILTER_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "in", "between"}
GRAINS = {"year", "quarter", "month"}
ColumnType = str


class CatalogError(Exception):
    def __init__(self, stage: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.stage = stage
        self.message = message
        self.details = details

    def to_dict(self) -> dict:
        error = {"stage": self.stage, "message": self.message}
        if self.details is not None:
            error["details"] = self.details
        return error


def serve(stage: str, handler: Callable[[dict], dict]) -> None:
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else None
    except json.JSONDecodeError:
        emit_error(stage, "Request JSON is invalid.", {"code": "invalid_json"})
        return

    if not isinstance(payload, dict):
        emit_error(stage, "Request JSON must be an object.", {"code": "invalid_json"})
        return

    try:
        result_key = "profile" if stage == "profile" else "result"
        emit({"ok": True, result_key: handler(payload)})
    except CatalogError as error:
        emit({"ok": False, "error": error.to_dict()})
    except Exception as error:  # noqa: BLE001 — last-resort envelope for the caller
        emit_error(stage, f"{type(error).__name__}: {error}", {"code": "unexpected"})
        sys.exit(1)


def emit(payload: dict) -> None:
    json.dump(payload, sys.stdout, allow_nan=False)
    sys.stdout.write("\n")


def emit_error(stage: str, message: str, details: dict | None = None) -> None:
    error = {"stage": stage, "message": message}
    if details is not None:
        error["details"] = details
    emit({"ok": False, "error": error})


def profile_csv(payload: dict) -> dict:
    csv_path = require_str(payload, "csvPath", "profile")
    dataset_id = require_str(payload, "datasetId", "profile")
    file_name = require_str(payload, "fileName", "profile")
    max_rows = require_positive_int(payload, "maxRows", "profile")
    frame = load_csv(csv_path, max_rows, "profile")

    columns = []
    warnings = []
    for name in frame.columns:
        column, warning = profile_column(str(name), frame[name])
        columns.append(column)
        if warning:
            warnings.append(warning)

    return {
        "datasetId": dataset_id,
        "fileName": file_name,
        "rowCount": int(len(frame)),
        "columns": columns,
        "warnings": warnings,
    }


def execute_csv(payload: dict) -> dict:
    csv_path = require_str(payload, "csvPath", "execute")
    max_rows = require_positive_int(payload, "maxRows", "execute")
    max_result_rows = require_positive_int(payload, "maxResultRows", "execute")
    plan = payload.get("plan")
    if not isinstance(plan, dict):
        raise CatalogError("execute", "Analysis plan is missing.", {"code": "invalid_operation"})

    frame = load_csv(csv_path, max_rows, "execute")
    profiles = {}
    for name in frame.columns:
        column, _warning = profile_column(str(name), frame[name])
        profiles[column["name"]] = column

    prepared = prepare_frame(frame, profiles)
    return execute_plan(prepared, profiles, plan, max_result_rows)


def load_csv(csv_path: str, max_rows: int, stage: str) -> pd.DataFrame:
    path = Path(csv_path)
    if not path.is_file():
        raise CatalogError(stage, "CSV file was not found.", {"code": "missing_file"})

    header = pd.read_csv(path, header=None, nrows=1)
    names = ["" if pd.isna(value) else str(value).strip() for value in header.iloc[0].tolist()]
    if not names or any(name == "" for name in names):
        raise CatalogError(stage, "CSV header contains an empty column name.", {"code": "invalid_csv"})
    if len(names) != len(set(names)):
        raise CatalogError(stage, "CSV header contains duplicate column names.", {"code": "invalid_csv"})

    frame = pd.read_csv(path, nrows=max_rows + 1)
    if len(frame) > max_rows:
        raise CatalogError(
            stage,
            f"CSV exceeds the maximum of {max_rows} rows.",
            {"code": "row_limit", "maxRows": max_rows},
        )
    return normalize_frame(frame)


def normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    for name in normalized.columns:
        series = normalized[name]
        if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
            text = series.astype("string").str.strip()
            normalized[name] = text.mask(text.str.len().fillna(0).eq(0), pd.NA)
    return normalized


def profile_column(name: str, series: pd.Series) -> tuple[dict, str | None]:
    column_type, warning_kind = classify_series(series)
    warning = warning_message(name, warning_kind) if warning_kind else None
    values = series.dropna()
    column = {
        "name": name,
        "type": column_type,
        "nullable": bool(series.isna().any()),
        "nullCount": int(series.isna().sum()),
        "distinctCount": int(values.nunique(dropna=True)),
        "sampleValues": sample_values(series, column_type),
    }

    if column_type == "number" and not values.empty:
        numeric = pd.to_numeric(values, errors="coerce").dropna()
        column["min"] = scalar_to_json(numeric.min())
        column["max"] = scalar_to_json(numeric.max())
    elif column_type == "date" and not values.empty:
        parsed = pd.to_datetime(values, format="%Y-%m-%d", errors="coerce").dropna()
        if not parsed.empty:
            column["min"] = parsed.min().strftime("%Y-%m-%d")
            column["max"] = parsed.max().strftime("%Y-%m-%d")

    return column, warning


def classify_series(series: pd.Series) -> tuple[ColumnType, str | None]:
    if pd.api.types.is_bool_dtype(series):
        return "boolean", None
    if pd.api.types.is_numeric_dtype(series):
        return "number", None
    if pd.api.types.is_datetime64_any_dtype(series):
        return "date", None

    values = series.dropna()
    if values.empty:
        return "unknown", "empty"

    text = values.astype("string")
    lowered = text.str.lower()
    if bool(lowered.isin(["true", "false"]).all()):
        return "boolean", None

    iso_mask = text.str.fullmatch(r"\d{4}-\d{2}-\d{2}").fillna(False)
    slash_mask = text.str.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}").fillna(False)
    numeric_mask = pd.to_numeric(text, errors="coerce").notna()

    if bool(iso_mask.all()):
        parsed = pd.to_datetime(text, format="%Y-%m-%d", errors="coerce")
        if bool(parsed.notna().all()):
            return "date", None
        return "unknown", "invalid_date"

    if bool(slash_mask.all()):
        return "unknown", "ambiguous_date"

    if bool(numeric_mask.all()):
        return "number", None

    if bool(iso_mask.any() or slash_mask.any() or numeric_mask.any()):
        return "unknown", "mixed"

    return "string", None


def warning_message(name: str, kind: str) -> str:
    if kind == "ambiguous_date":
        return f"Column '{name}' uses ambiguous day/month dates and was marked unknown."
    if kind == "mixed":
        return f"Column '{name}' has mixed value types and was marked unknown."
    if kind == "invalid_date":
        return f"Column '{name}' contains invalid dates and was marked unknown."
    if kind == "empty":
        return f"Column '{name}' is empty and was marked unknown."
    return f"Column '{name}' could not be typed and was marked unknown."


def sample_values(series: pd.Series, column_type: str) -> list[str]:
    samples: list[str] = []
    for value in series.tolist():
        if bool(pd.isna(value)):
            continue
        text = format_sample(value, column_type)
        if text not in samples:
            samples.append(text)
        if len(samples) == SAMPLE_LIMIT:
            break
    return samples


def format_sample(value: object, column_type: str) -> str:
    converted = scalar_to_json(value)
    if isinstance(converted, bool):
        return "true" if converted else "false"
    if column_type == "date" and isinstance(converted, str):
        return converted
    if converted is None:
        return ""
    return str(converted)


def prepare_frame(frame: pd.DataFrame, profiles: dict[str, dict]) -> pd.DataFrame:
    prepared = pd.DataFrame(index=frame.index)
    for name, profile in profiles.items():
        column_type = profile["type"]
        series = frame[name]
        if column_type == "number":
            prepared[name] = pd.to_numeric(series, errors="coerce")
        elif column_type == "date":
            prepared[name] = pd.to_datetime(series, format="%Y-%m-%d", errors="coerce")
        elif column_type == "boolean":
            prepared[name] = series.map(parse_bool, na_action="ignore")
        else:
            text = series.astype("string").str.strip()
            prepared[name] = text.mask(text.str.len().fillna(0).eq(0), pd.NA)
    return prepared


def parse_bool(value: object) -> bool | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text == "true":
        return True
    if text == "false":
        return False
    return None


def execute_plan(frame: pd.DataFrame, profiles: dict[str, dict], plan: dict, max_result_rows: int) -> dict:
    operation = plan.get("operation")
    if operation not in OPERATIONS:
        raise CatalogError(
            "execute",
            f"Invalid operation: {operation!r}.",
            {"code": "invalid_operation", "operation": operation},
        )
    if operation == "aggregate":
        return run_aggregate(frame, profiles, plan, max_result_rows)
    if operation == "trend":
        return run_trend(frame, profiles, plan, max_result_rows)
    return run_detail(frame, profiles, plan, max_result_rows)


def run_aggregate(frame: pd.DataFrame, profiles: dict[str, dict], plan: dict, max_result_rows: int) -> dict:
    group_by = require_columns(plan.get("groupBy", []), profiles, allow_unknown=False)
    metrics = require_metrics(plan.get("metrics"), profiles)
    filtered = apply_filters(frame, profiles, plan.get("filters", []))
    return aggregate_rows(
        filtered,
        profiles,
        group_by,
        metrics,
        plan.get("sortBy"),
        plan.get("sortDirection"),
        plan.get("limit"),
        max_result_rows,
    )


def run_trend(frame: pd.DataFrame, profiles: dict[str, dict], plan: dict, max_result_rows: int) -> dict:
    time_column = plan.get("timeColumn")
    grain = plan.get("grain")
    if not isinstance(time_column, str) or not time_column:
        raise CatalogError("execute", "Trend requires a time column.", {"code": "invalid_operation"})
    if time_column not in profiles:
        raise unknown_column(time_column)
    if profiles[time_column]["type"] != "date":
        raise CatalogError(
            "execute",
            f"Column '{time_column}' is not a date column.",
            {"code": "invalid_filter", "column": time_column},
        )
    if grain not in GRAINS:
        raise CatalogError(
            "execute",
            "Trend grain must be year, quarter, or month.",
            {"code": "invalid_operation", "grain": grain},
        )

    metrics = require_metrics(plan.get("metrics"), profiles)
    filtered = apply_filters(frame, profiles, plan.get("filters", []))
    working = filtered.dropna(subset=[time_column]).copy()
    timestamps = working[time_column]
    if grain == "year":
        working["period"] = timestamps.dt.strftime("%Y")
    elif grain == "quarter":
        working["period"] = timestamps.dt.year.astype("string") + "-Q" + timestamps.dt.quarter.astype("string")
    else:
        working["period"] = timestamps.dt.strftime("%Y-%m")

    period_profile = {
        "name": "period",
        "type": "string",
        "nullable": False,
        "nullCount": 0,
        "distinctCount": 0,
        "sampleValues": [],
    }
    trend_profiles = {**profiles, "period": period_profile}
    sort_by = plan.get("sortBy")
    sort_direction = plan.get("sortDirection")
    default_sort = None if sort_by else ("period", "asc")
    return aggregate_rows(
        working,
        trend_profiles,
        ["period"],
        metrics,
        sort_by,
        sort_direction,
        plan.get("limit"),
        max_result_rows,
        default_sort=default_sort,
    )


def run_detail(frame: pd.DataFrame, profiles: dict[str, dict], plan: dict, max_result_rows: int) -> dict:
    select = plan.get("select")
    if not isinstance(select, list) or len(select) == 0:
        raise CatalogError(
            "execute",
            "Detail requires at least one selected column.",
            {"code": "invalid_operation"},
        )
    if len(select) != len(set(select)):
        raise CatalogError("execute", "Selected columns must be unique.", {"code": "invalid_operation"})

    names = require_columns(select, profiles, allow_unknown=True)
    filtered = apply_filters(frame, profiles, plan.get("filters", []))
    subset = filtered.loc[:, names]
    columns = [{"name": name, "type": profiles[name]["type"]} for name in names]
    return finish_frame(
        subset,
        columns,
        plan.get("sortBy"),
        plan.get("sortDirection"),
        plan.get("limit"),
        max_result_rows,
    )


def aggregate_rows(
    frame: pd.DataFrame,
    profiles: dict[str, dict],
    group_by: list[str],
    metrics: list[dict],
    sort_by: object,
    sort_direction: object,
    limit: object,
    max_result_rows: int,
    default_sort: tuple[str, str] | None = None,
) -> dict:
    metric_names = [metric_output_name(metric) for metric in metrics]
    if len(metric_names) != len(set(metric_names)) or set(metric_names) & set(group_by):
        raise CatalogError(
            "execute",
            "Metric output names must be unique and must not match group columns.",
            {"code": "invalid_metric"},
        )

    if group_by and frame.empty:
        result = pd.DataFrame(columns=[*group_by, *metric_names])
    elif not group_by:
        row = {}
        for metric, name in zip(metrics, metric_names, strict=True):
            column = metric_column(metric)
            if metric["agg"] == "count" and column is None:
                row[name] = int(len(frame))
            else:
                row[name] = reduce_series(frame[column], metric["agg"])
        result = pd.DataFrame([row])
    else:
        grouped = frame.groupby(group_by, dropna=False, sort=True)
        reduced = []
        for metric, name in zip(metrics, metric_names, strict=True):
            series = reduce_grouped(grouped, metric_column(metric), metric["agg"])
            series.name = name
            reduced.append(series)
        result = pd.concat(reduced, axis=1).reset_index()

    columns = [{"name": name, "type": profiles[name]["type"]} for name in group_by]
    columns.extend({"name": name, "type": "number"} for name in metric_names)
    return finish_frame(
        result,
        columns,
        sort_by,
        sort_direction,
        limit,
        max_result_rows,
        default_sort=default_sort,
    )


def finish_frame(
    frame: pd.DataFrame,
    columns: list[dict],
    sort_by: object,
    sort_direction: object,
    limit: object,
    max_result_rows: int,
    default_sort: tuple[str, str] | None = None,
) -> dict:
    ordered = frame
    if isinstance(sort_by, str) and sort_by:
        ordered = sort_frame(frame, sort_by, sort_direction)
    elif default_sort:
        ordered = sort_frame(frame, default_sort[0], default_sort[1])

    limited, truncated = apply_result_limit(ordered, limit, max_result_rows)
    rows = []
    for record in limited.to_dict(orient="records"):
        row = {}
        for column in columns:
            row[column["name"]] = scalar_to_json(record.get(column["name"]))
        rows.append(row)

    return {
        "columns": columns,
        "rows": rows,
        "rowCount": len(rows),
        "truncated": truncated,
    }


def require_metrics(metrics: object, profiles: dict[str, dict]) -> list[dict]:
    if not isinstance(metrics, list) or len(metrics) == 0:
        raise CatalogError("execute", "At least one metric is required.", {"code": "invalid_metric"})

    checked = []
    for metric in metrics:
        if not isinstance(metric, dict):
            raise CatalogError("execute", "Each metric must be an object.", {"code": "invalid_metric"})
        aggregation = metric.get("agg")
        if aggregation not in AGGREGATIONS:
            raise CatalogError(
                "execute",
                f"Invalid metric aggregation: {aggregation!r}.",
                {"code": "invalid_metric", "agg": aggregation},
            )
        column = metric.get("column")
        if column is None or column == "":
            if aggregation != "count":
                raise CatalogError(
                    "execute",
                    f"Aggregation '{aggregation}' requires a column.",
                    {"code": "invalid_metric", "agg": aggregation},
                )
            checked.append({"agg": aggregation})
            continue
        if not isinstance(column, str) or column not in profiles:
            raise unknown_column(column if isinstance(column, str) else "")
        column_type = profiles[column]["type"]
        if aggregation in NUMERIC_AGGREGATIONS and column_type != "number":
            raise CatalogError(
                "execute",
                f"Cannot {aggregation} non-numeric column '{column}'.",
                {"code": "invalid_metric", "column": column, "agg": aggregation},
            )
        if column_type == "unknown":
            raise CatalogError(
                "execute",
                f"Cannot aggregate unknown column '{column}'.",
                {"code": "invalid_metric", "column": column},
            )
        checked.append({"agg": aggregation, "column": column})
    return checked


def metric_column(metric: dict) -> str | None:
    column = metric.get("column")
    if isinstance(column, str) and column:
        return column
    return None


def metric_output_name(metric: dict) -> str:
    column = metric_column(metric)
    if metric["agg"] == "count" and column is None:
        return "count"
    return f"{metric['agg']}_{column}"


def require_columns(names: object, profiles: dict[str, dict], allow_unknown: bool) -> list[str]:
    if not isinstance(names, list):
        raise CatalogError("execute", "Column list is invalid.", {"code": "unknown_column"})
    checked = []
    for name in names:
        if not isinstance(name, str) or name not in profiles:
            raise unknown_column(name if isinstance(name, str) else "")
        if not allow_unknown and profiles[name]["type"] == "unknown":
            raise CatalogError(
                "execute",
                f"Cannot use unknown column '{name}'.",
                {"code": "invalid_column", "column": name},
            )
        checked.append(name)
    return checked


def apply_filters(frame: pd.DataFrame, profiles: dict[str, dict], filters: object) -> pd.DataFrame:
    if filters is None:
        filters = []
    if not isinstance(filters, list):
        raise CatalogError("execute", "Filters must be a list.", {"code": "invalid_filter"})

    mask = pd.Series(True, index=frame.index)
    for item in filters:
        mask = mask & filter_mask(frame, profiles, item)
    return frame.loc[mask.fillna(False)]


def filter_mask(frame: pd.DataFrame, profiles: dict[str, dict], item: object) -> pd.Series:
    if not isinstance(item, dict):
        raise CatalogError("execute", "Each filter must be an object.", {"code": "invalid_filter"})

    column = item.get("column")
    op = item.get("op")
    if not isinstance(column, str) or column not in profiles:
        raise unknown_column(column if isinstance(column, str) else "")
    if op not in FILTER_OPS:
        raise CatalogError("execute", f"Invalid filter operator: {op!r}.", {"code": "invalid_filter", "op": op})

    column_type = profiles[column]["type"]
    if column_type == "unknown":
        raise CatalogError(
            "execute",
            f"Cannot filter unknown column '{column}'.",
            {"code": "invalid_filter", "column": column},
        )

    series = frame[column]
    value = item.get("value")
    if column_type == "string":
        return string_mask(series, op, value, column)
    if column_type == "boolean":
        return boolean_mask(series, op, value, column)
    if column_type == "number":
        return number_mask(series, op, value, column)
    return date_mask(series, op, value, column)


def string_mask(series: pd.Series, op: str, value: object, column: str) -> pd.Series:
    if op not in {"eq", "neq", "in"}:
        raise CatalogError(
            "execute",
            f"Operator '{op}' is not valid for string column '{column}'.",
            {"code": "invalid_filter", "column": column, "op": op},
        )
    if op == "in":
        values = require_string_list(value, column)
        return series.isin(values).fillna(False)
    if not isinstance(value, str):
        raise CatalogError(
            "execute",
            f"Filter value for '{column}' must be a string.",
            {"code": "invalid_filter", "column": column},
        )
    if op == "eq":
        return series.eq(value).fillna(False)
    return series.ne(value).fillna(False)


def boolean_mask(series: pd.Series, op: str, value: object, column: str) -> pd.Series:
    if op not in {"eq", "neq"} or not isinstance(value, bool):
        raise CatalogError(
            "execute",
            f"Boolean column '{column}' only supports eq and neq with true or false.",
            {"code": "invalid_filter", "column": column, "op": op},
        )
    if op == "eq":
        return series.eq(value).fillna(False)
    return series.ne(value).fillna(False)


def number_mask(series: pd.Series, op: str, value: object, column: str) -> pd.Series:
    if op == "between":
        pair = require_number_pair(value, column)
        return (series.ge(pair[0]) & series.le(pair[1])).fillna(False)
    if op == "in":
        numbers = require_number_list(value, column)
        return series.isin(numbers).fillna(False)
    number = require_number(value, column)
    if op == "eq":
        return series.eq(number).fillna(False)
    if op == "neq":
        return series.ne(number).fillna(False)
    if op == "gt":
        return series.gt(number).fillna(False)
    if op == "gte":
        return series.ge(number).fillna(False)
    if op == "lt":
        return series.lt(number).fillna(False)
    if op == "lte":
        return series.le(number).fillna(False)
    raise CatalogError("execute", f"Invalid filter operator: {op!r}.", {"code": "invalid_filter", "op": op})


def date_mask(series: pd.Series, op: str, value: object, column: str) -> pd.Series:
    if op == "between":
        if not isinstance(value, list) or len(value) != 2:
            raise CatalogError(
                "execute",
                f"Between filter for '{column}' requires two dates.",
                {"code": "invalid_filter", "column": column},
            )
        start = parse_iso_date(value[0], column)
        end = parse_iso_date(value[1], column)
        return (series.ge(start) & series.le(end)).fillna(False)
    if op == "in":
        if not isinstance(value, list) or len(value) == 0:
            raise CatalogError(
                "execute",
                f"In filter for '{column}' requires a non-empty date list.",
                {"code": "invalid_filter", "column": column},
            )
        parsed = [parse_iso_date(item, column) for item in value]
        return series.isin(parsed).fillna(False)
    parsed = parse_iso_date(value, column)
    if op == "eq":
        return series.eq(parsed).fillna(False)
    if op == "neq":
        return series.ne(parsed).fillna(False)
    if op == "gt":
        return series.gt(parsed).fillna(False)
    if op == "gte":
        return series.ge(parsed).fillna(False)
    if op == "lt":
        return series.lt(parsed).fillna(False)
    if op == "lte":
        return series.le(parsed).fillna(False)
    raise CatalogError("execute", f"Invalid filter operator: {op!r}.", {"code": "invalid_filter", "op": op})


def reduce_series(series: pd.Series, aggregation: str) -> object:
    if aggregation == "sum":
        return series.sum()
    if aggregation == "mean":
        return series.mean()
    if aggregation == "min":
        return series.min()
    if aggregation == "max":
        return series.max()
    if aggregation == "count":
        return series.count()
    raise CatalogError("execute", f"Invalid metric aggregation: {aggregation!r}.", {"code": "invalid_metric"})


def reduce_grouped(grouped: pd.core.groupby.generic.DataFrameGroupBy, column: str | None, aggregation: str) -> pd.Series:
    if aggregation == "count" and column is None:
        return grouped.size()
    if column is None:
        raise CatalogError("execute", f"Aggregation '{aggregation}' requires a column.", {"code": "invalid_metric"})
    values = grouped[column]
    if aggregation == "sum":
        return values.sum()
    if aggregation == "mean":
        return values.mean()
    if aggregation == "min":
        return values.min()
    if aggregation == "max":
        return values.max()
    if aggregation == "count":
        return values.count()
    raise CatalogError("execute", f"Invalid metric aggregation: {aggregation!r}.", {"code": "invalid_metric"})


def sort_frame(frame: pd.DataFrame, sort_by: str, direction: object) -> pd.DataFrame:
    if sort_by not in frame.columns:
        raise unknown_column(sort_by)
    if direction not in {None, "asc", "desc"}:
        raise CatalogError(
            "execute",
            "Sort direction must be asc or desc.",
            {"code": "invalid_operation", "sortDirection": direction},
        )
    return frame.sort_values(by=sort_by, ascending=direction != "desc", kind="mergesort", na_position="last")


def apply_result_limit(frame: pd.DataFrame, limit: object, max_result_rows: int) -> tuple[pd.DataFrame, bool]:
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise CatalogError("execute", "Result limit must be a positive integer.", {"code": "result_limit"})
    if limit > max_result_rows:
        raise CatalogError(
            "execute",
            f"Result limit {limit} exceeds the configured maximum of {max_result_rows} rows.",
            {"code": "result_limit", "limit": limit, "maxResultRows": max_result_rows},
        )
    truncated = len(frame) > limit
    return frame.head(limit), truncated


def require_number(value: object, column: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise CatalogError(
            "execute",
            f"Filter value for '{column}' must be a finite number.",
            {"code": "invalid_filter", "column": column},
        )
    return float(value)


def require_number_list(value: object, column: str) -> list[float]:
    if not isinstance(value, list) or len(value) == 0:
        raise CatalogError(
            "execute",
            f"In filter for '{column}' requires a non-empty number list.",
            {"code": "invalid_filter", "column": column},
        )
    return [require_number(item, column) for item in value]


def require_number_pair(value: object, column: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise CatalogError(
            "execute",
            f"Between filter for '{column}' requires two numbers.",
            {"code": "invalid_filter", "column": column},
        )
    return require_number(value[0], column), require_number(value[1], column)


def require_string_list(value: object, column: str) -> list[str]:
    if not isinstance(value, list) or len(value) == 0 or not all(isinstance(item, str) for item in value):
        raise CatalogError(
            "execute",
            f"In filter for '{column}' requires a non-empty string list.",
            {"code": "invalid_filter", "column": column},
        )
    return list(value)


def parse_iso_date(value: object, column: str) -> pd.Timestamp:
    if not isinstance(value, str):
        raise CatalogError(
            "execute",
            f"Filter value for '{column}' must be an ISO date (YYYY-MM-DD).",
            {"code": "invalid_filter", "column": column},
        )
    parsed = pd.to_datetime(value, format="%Y-%m-%d", errors="coerce")
    if pd.isna(parsed):
        raise CatalogError(
            "execute",
            f"Filter value for '{column}' must be an ISO date (YYYY-MM-DD).",
            {"code": "invalid_filter", "column": column},
        )
    return parsed


def unknown_column(column: str) -> CatalogError:
    label = column or "(missing)"
    return CatalogError("execute", f"Unknown column: {label}.", {"code": "unknown_column", "column": column})


def require_str(payload: dict, key: str, stage: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise CatalogError(stage, f"{key} is required.", {"code": "invalid_json", "field": key})
    return value


def require_positive_int(payload: dict, key: str, stage: str) -> int:
    value = payload.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise CatalogError(stage, f"{key} must be a positive integer.", {"code": "invalid_json", "field": key})
    return value


def scalar_to_json(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        try:
            value = value.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(value, bool):
        return bool(value)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer():
            return int(value)
        return value
    if isinstance(value, str):
        return value
    return str(value)
