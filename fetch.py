import datetime
import os
import time
import traceback

import flask
import requests
from flask_apscheduler import APScheduler
from flask_cors import CORS

APIKEY = os.getenv("TIANAPI_KEY", "xxx")
HEFENG_KEY = os.getenv("QWEATHER_KEY", "xxx")
CURR_POS = os.getenv("QWEATHER_LOCATION", "xxx")
INNER_SENSOR_MAC = os.getenv("SENSOR_INNER_MAC", "A4:C1:38:CF:B0:D6")
OUTER_SENSOR_MAC = os.getenv("SENSOR_OUTER_MAC", "A4:C1:38:D5:05:79")
APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "3643"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT_SECONDS", "10"))

ELEGANT_SENTENCE_QUERY = "https://apis.tianapi.com/one/index"
DATE_QUERY = "https://apis.tianapi.com/lunar/index"
WARNING_QUERY = "https://devapi.qweather.com/v7/warning/now"

elegant_sentence_data = {}
lunar_data = {}
warning_data = {}


def empty_sensor_state():
    return {
        "temp": "-",
        "humi": "-",
        "volt": "Nodata",
        "name": "Nodata",
        "rssi": "Nodata",
        "batt": "Nodata",
        "time": "-",
        "stamp": time.time(),
    }


def build_sensor_state(name, temp, humi, volt, rssi, batt):
    return {
        "temp": temp,
        "humi": humi,
        "volt": volt,
        "name": name,
        "rssi": rssi,
        "batt": batt,
        "time": time.asctime(time.localtime(time.time())),
        "stamp": time.time(),
    }


innersen = empty_sensor_state()
outersen = empty_sensor_state()
extra_sensors = {}

rev_db_add1 = False
rev_db_add2 = False


class Config(object):
    SCHEDULER_API_ENABLED = True


scheduler = APScheduler()
app = flask.Flask(__name__)
CORS(app, resources=r"/*")


@app.route("/healthz")
def healthz():
    return flask.jsonify({"ok": True})


@app.route("/warning")
def get_warning():
    return flask.jsonify(warning_data)


@app.route("/lunar")
def get_lunar():
    return flask.jsonify(lunar_data)


@app.route("/elegent")
def get_sentence():
    return flask.jsonify(elegant_sentence_data)


@app.route("/sensors", methods=["GET", "POST"])
def fetch_sensor():
    global innersen, outersen, extra_sensors, rev_db_add1, rev_db_add2

    name = flask.request.args.get("name")
    temp = flask.request.args.get("temp")
    humi = flask.request.args.get("humi")
    batt = flask.request.args.get("bat")
    volt = flask.request.args.get("volt")
    rssi = flask.request.args.get("rssi")

    try:
        if name == INNER_SENSOR_MAC:
            innersen = build_sensor_state(name, temp, humi, volt, rssi, batt)
            rev_db_add1 = not rev_db_add1

        elif name == OUTER_SENSOR_MAC:
            outersen = build_sensor_state(name, temp, humi, volt, rssi, batt)
            rev_db_add2 = not rev_db_add2
        elif name:
            extra_sensors[name] = build_sensor_state(name, temp, humi, volt, rssi, batt)
    finally:
        return "123"


@app.route("/getSensor", methods=["GET"])
def get_sensor():
    sensors = [innersen, outersen]
    for sensor_name in sorted(extra_sensors.keys()):
        sensors.append(extra_sensors[sensor_name])
    return flask.jsonify(sensors)


def fetch_json(url):
    return requests.get(url, timeout=REQUEST_TIMEOUT).json()


def update_elegant_sentence():
    global elegant_sentence_data

    try:
        while True:
            elegant_sentence_data = fetch_json(f"{ELEGANT_SENTENCE_QUERY}?key={APIKEY}&rand=1")
            result = elegant_sentence_data.get("result", {})
            word = result.get("word", "")
            word_from = result.get("wordfrom", "")
            if len(word) + len(word_from) < 60:
                break
    except Exception:
        traceback.print_exc()


@scheduler.task("cron", id="update_lunar_job", hour="*", misfire_grace_time=900)
def update_lunar():
    global lunar_data

    try:
        today = datetime.datetime.now().strftime("%Y-%m-%d")
        lunar_data = fetch_json(f"{DATE_QUERY}?key={APIKEY}&date={today}")
    except Exception:
        traceback.print_exc()


@scheduler.task("interval", id="update_warning_job", seconds=1800, misfire_grace_time=900)
def update_warning():
    global warning_data

    try:
        warning_data = fetch_json(f"{WARNING_QUERY}?key={HEFENG_KEY}&location={CURR_POS}")
    except Exception:
        traceback.print_exc()


@scheduler.task("interval", id="delete_stale_sensor_job", seconds=700, misfire_grace_time=900)
def delete_data():
    global innersen, outersen, extra_sensors

    now = time.time()

    if now - innersen["stamp"] > 1500:
        innersen = empty_sensor_state()

    if now - outersen["stamp"] > 1500:
        outersen = empty_sensor_state()

    stale_sensor_names = []
    for sensor_name, sensor_state in extra_sensors.items():
        if now - sensor_state.get("stamp", 0) > 1500:
            stale_sensor_names.append(sensor_name)

    for sensor_name in stale_sensor_names:
        extra_sensors.pop(sensor_name, None)


app.config.from_object(Config())
scheduler.init_app(app)
scheduler.start()
# update_elegant_sentence()
scheduler.run_job("update_lunar_job")
scheduler.run_job("update_warning_job")


if __name__ == "__main__":
    app.run(host=APP_HOST, port=APP_PORT)
