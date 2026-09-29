"""Read an analysis request from stdin and write an AnalysisResult envelope to stdout."""

from catalog import execute_csv, serve

if __name__ == "__main__":
    serve("execute", execute_csv)
