"""Read a profile request from stdin and write a DatasetProfile envelope to stdout."""

from catalog import profile_csv, serve

if __name__ == "__main__":
    serve("profile", profile_csv)
