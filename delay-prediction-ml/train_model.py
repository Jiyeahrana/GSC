import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.preprocessing import OneHotEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error
import joblib
from sklearn.linear_model import Ridge

CSV_PATH = "data/delay-prediction.csv"

CATEGORICAL_COLS = [
    "weather_condition_departure",
    "weather_condition_arrival",
    "route_type",
    "vehicle_type",
    "priority_level",
    "shipment_type",
]

NUMERIC_COLS = [
    "route_distance_km",
    "carrier_on_time_rate",
]

TARGET = "delay_actual_minutes"


def load_data():
    df = pd.read_csv(CSV_PATH)

    # Drop rows with no actual delay (scheduled/in_transit shipments)
    df = df[df[TARGET].notna() & (df[TARGET] != "")]
    df[TARGET] = df[TARGET].astype(float)

    # Fill categorical NaNs
    for col in CATEGORICAL_COLS:
        df[col] = df[col].fillna("unknown").str.lower()

    # Fill numeric NaNs
    for col in NUMERIC_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
        df[col] = df[col].fillna(df[col].median())

    return df


def build_pipeline():
    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_COLS),
            ("num", "passthrough", NUMERIC_COLS),
        ]
    )

    model = Ridge(alpha=10.0)

    pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("regressor", model),
    ])

    return pipeline

from sklearn.model_selection import cross_val_score, KFold

def main():
    df = load_data()
    X = df[CATEGORICAL_COLS + NUMERIC_COLS]
    y = df[TARGET]

    pipeline = build_pipeline()

    cv = KFold(n_splits=5, shuffle=True, random_state=42)
    r2_scores = cross_val_score(pipeline, X, y, cv=cv, scoring="r2")
    mae_scores = -cross_val_score(pipeline, X, y, cv=cv, scoring="neg_mean_absolute_error")

    print(f"CV R²:  {r2_scores.mean():.3f} (+/- {r2_scores.std():.3f})")
    print(f"CV MAE: {mae_scores.mean():.2f} minutes")

    pipeline.fit(X, y)

    feature_names = (
        pipeline.named_steps["preprocessor"]
        .named_transformers_["cat"]
        .get_feature_names_out(CATEGORICAL_COLS)
        .tolist()
        + NUMERIC_COLS
    )
    coefs = pipeline.named_steps["regressor"].coef_
    top = sorted(zip(feature_names, coefs), key=lambda x: -abs(x[1]))[:10]
    print("\nTop features (by coefficient magnitude):")
    for name, c in top:
        print(f"  {name}: {c:.3f}")

    joblib.dump(pipeline, "model.pkl")
    joblib.dump({"r2": r2_scores.mean(), "mae": mae_scores.mean(), "trained_rows": len(X)}, "model_meta.pkl")
    print("\nSaved model.pkl")
    
if __name__ == "__main__":
    main()