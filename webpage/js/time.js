const appConfig = window.__APP_CONFIG__ || {};
const apiBaseUrl = (appConfig.apiBaseUrl || "http://127.0.0.1:3643").replace(/\/$/, "");
const configuredSensorTimeoutSeconds = Number.parseInt(appConfig.sensorTimeoutSeconds, 10);
const sensorTimeoutSeconds = Number.isFinite(configuredSensorTimeoutSeconds) && configuredSensorTimeoutSeconds > 0
    ? configuredSensorTimeoutSeconds
    : 20 * 60;

const sensorQuery = appConfig.sensorQueryUrl || `${apiBaseUrl}/getSensor`;
const dateQuery = `${apiBaseUrl}/lunar`;
const warningQuery = `${apiBaseUrl}/warning`;

const renderState = {
    lunar: false,
    power: false,
    sensor: false,
    time: false,
    warning: false,
    widget: false,
};

window.__KINDLE_RENDER_READY__ = false;

function markRenderReady(step) {
    if (!renderState[step]) {
        renderState[step] = true;
    }

    if (Object.values(renderState).every(Boolean)) {
        window.__KINDLE_RENDER_READY__ = true;
    }
}

setTimeout(() => {
    window.__KINDLE_RENDER_READY__ = true;
}, 18000);

function formatDate(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}-${month < 10 ? '0' + month : month}-${day < 10 ? '0' + day : day}`;
}

function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(response => {
        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }
        return response.json();
    });
}

function fitFestivalText() {
    const festivalNode = document.getElementById("festival");
    if (!festivalNode) {
        return;
    }

    const maxFontRem = 2;
    const minFontRem = 1;
    const stepRem = 0.05;

    let currentSize = maxFontRem;
    festivalNode.style.fontSize = `${currentSize}rem`;

    while (festivalNode.scrollWidth > festivalNode.clientWidth && currentSize > minFontRem) {
        currentSize = Math.max(minFontRem, Number((currentSize - stepRem).toFixed(2)));
        festivalNode.style.fontSize = `${currentSize}rem`;
    }
}

function updateTime() {
    const date = new Date();
    const utc8DiffMinutes = date.getTimezoneOffset() + 480;
    date.setMinutes(date.getMinutes() + utc8DiffMinutes);

    const timeString = `${('0' + date.getHours()).slice(-2)}:${('0' + date.getMinutes()).slice(-2)}`;
    const dateString = `${date.getFullYear()}-${('0' + (date.getMonth() + 1)).slice(-2)}-${('0' + date.getDate()).slice(-2)}`;
    const weekList = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    document.getElementById("date").innerHTML = dateString;
    document.getElementById("week").innerHTML = weekList[date.getDay()];
    document.getElementById("time").innerHTML = timeString;
    markRenderReady("time");
}

async function updateLunar() {
    try {
        const resp = await fetchJson(dateQuery);
        if (resp.code !== 200) {
            return;
        }

        const dayString = "农历" + resp.result.lubarmonth + resp.result.lunarday;
        const jieqi = resp.result.jieqi;
        const lunarFestival = resp.result.lunar_festival;
        const festival = resp.result.festival;

        document.getElementById("lunar").innerHTML = dayString;

        const finalAnsParts = [];
        if (jieqi !== "") {
            finalAnsParts.push(jieqi);
        }
        if (lunarFestival !== "") {
            finalAnsParts.push(lunarFestival);
        }
        if (festival !== "") {
            finalAnsParts.push(festival);
        }

        const festivalNode = document.getElementById("festival");
        festivalNode.textContent = finalAnsParts.join("  ");
        fitFestivalText();
    } catch (error) {
        console.error("updateLunar failed", error);
    } finally {
        markRenderReady("lunar");
    }
}

function putPicByPower(power, isCharging) {
    document.getElementById("batteryLevel").innerHTML = power.toString() + "%";
    if (!isCharging) {
        if (power > 75) {
            document.getElementById("batt").src = "./img/bat_100.png";
        } else if (power > 50) {
            document.getElementById("batt").src = "./img/bat_75.png";
        } else if (power > 25) {
            document.getElementById("batt").src = "./img/bat_50.png";
        } else {
            document.getElementById("batt").src = "./img/bat_25.png";
        }
    } else {
        document.getElementById("batt").src = "./img/rec.png";
    }
}

function updatePower() {
    const queryArray = window.location.search.replace("?", "").split("&");
    let power = 0;
    let charge = "";

    queryArray.forEach(element => {
        const tmp = element.split("=");
        if (tmp[0] === "batt") {
            power = parseInt(tmp[1], 10);
        }
        if (tmp[0] === "charge") {
            charge = tmp[1];
        }
    });

    putPicByPower(Number.isNaN(power) ? 0 : power, charge === "Charging");
    markRenderReady("power");
}

function isWeatherWidgetRendered() {
    const widgetImage = document.getElementById("widgetCacheImage");
    if (!widgetImage) {
        return true;
    }

    return widgetImage.complete && widgetImage.naturalWidth > 0;
}

function waitForWidgetRender() {
    const startedAt = Date.now();
    const timeoutMs = 12000;

    function finalize() {
        markRenderReady("widget");
    }

    function poll() {
        if (isWeatherWidgetRendered()) {
            finalize();
            return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
            console.warn("weather widget did not finish rendering before timeout");
            finalize();
            return;
        }

        window.setTimeout(poll, 250);
    }

    poll();
}

async function updateWarning() {
    try {
        const resp = await fetchJson(warningQuery);
        if (resp.code !== 200 || !Array.isArray(resp.warning) || resp.warning.length === 0) {
            return;
        }

        const warningNode = document.getElementById("warning");
        warningNode.innerHTML = "";

        resp.warning.forEach(ele => {
            const iconCode = ele.type.replace(/[^0-9]/g, "");
            const imgNode = document.createElement("img");
            imgNode.src = "./img/icons/" + iconCode + ".svg";
            warningNode.appendChild(imgNode);
        });
    } catch (error) {
        console.error("updateWarning failed", error);
    } finally {
        markRenderReady("warning");
    }
}

function formatSensorValue(value, unit) {
    const normalized = `${value ?? ""}`.trim();
    if (normalized === "" || normalized === "-" || normalized.toLowerCase() === "nodata") {
        return `--${unit}`;
    }
    return `${normalized}${unit}`;
}

function hasSensorValue(sensor) {
    if (!sensor || typeof sensor !== "object") {
        return false;
    }

    const temp = `${sensor.temp ?? ""}`.trim().toLowerCase();
    const humi = `${sensor.humi ?? ""}`.trim().toLowerCase();
    return temp !== "" && temp !== "-" && temp !== "nodata"
        && humi !== "" && humi !== "-" && humi !== "nodata";
}

function getSensorLabel(sensor, index) {
    const displayName = `${sensor?.display_name ?? ""}`.trim();
    if (displayName !== "" && displayName.toLowerCase() !== "nodata") {
        return displayName;
    }

    const macName = `${sensor?.name ?? ""}`.trim();
    if (macName !== "" && macName.toLowerCase() !== "nodata") {
        return macName;
    }

    return `传感器${index + 1}`;
}

function createSensorChip(label, value) {
    const chipNode = document.createElement("div");
    chipNode.className = "sen-chip";

    const nameNode = document.createElement("span");
    nameNode.className = "sen-chip-name";
    nameNode.textContent = label;

    const valueNode = document.createElement("label");
    valueNode.className = "sen-value";
    valueNode.textContent = value;

    chipNode.appendChild(nameNode);
    chipNode.appendChild(valueNode);
    return chipNode;
}

function renderSensorRowValues(containerId, sensors, unit, picker) {
    const containerNode = document.getElementById(containerId);
    if (!containerNode) {
        return;
    }

    containerNode.innerHTML = "";

    if (!Array.isArray(sensors) || sensors.length === 0) {
        containerNode.appendChild(createSensorChip("传感器", formatSensorValue("-", unit)));
        return;
    }

    sensors.forEach((sensor, index) => {
        const label = getSensorLabel(sensor, index);
        const value = formatSensorValue(picker(sensor), unit);
        containerNode.appendChild(createSensorChip(label, value));
    });
}

function isSensorTimedOut(sensor) {
    if (!sensor || typeof sensor !== "object") {
        return true;
    }

    const stamp = Number(sensor.stamp);
    if (!hasSensorValue(sensor) || !Number.isFinite(stamp) || stamp <= 0) {
        return true;
    }

    return Date.now() / 1000 - stamp > sensorTimeoutSeconds;
}

function updateSensorTimeoutBanner(sensors) {
    const timeoutNode = document.getElementById("sensor-timeout");
    if (!timeoutNode) {
        return;
    }

    const sensorList = Array.isArray(sensors) ? sensors : [];
    if (sensorList.length === 0) {
        timeoutNode.textContent = "传感器上报超时";
        timeoutNode.hidden = false;
        return;
    }

    const timeoutTargets = [];
    sensorList.forEach((sensor, index) => {
        if (isSensorTimedOut(sensor)) {
            timeoutTargets.push(getSensorLabel(sensor, index));
        }
    });

    if (timeoutTargets.length === 0) {
        timeoutNode.hidden = true;
        timeoutNode.textContent = "";
        return;
    }

    timeoutNode.textContent = `${timeoutTargets.join("、")}上报超时`;
    timeoutNode.hidden = false;
}

async function renderSensors() {
    try {
        const resp = await fetchJson(sensorQuery);
        const sensors = Array.isArray(resp)
            ? resp.filter(sensor => sensor && typeof sensor === "object")
            : [];
        renderSensorRowValues("temp-values", sensors, "°C", sensor => sensor.temp);
        renderSensorRowValues("humi-values", sensors, "%", sensor => sensor.humi);
        updateSensorTimeoutBanner(sensors);
    } catch (error) {
        console.error("renderSensors failed", error);
        renderSensorRowValues("temp-values", [], "°C", sensor => sensor.temp);
        renderSensorRowValues("humi-values", [], "%", sensor => sensor.humi);
        updateSensorTimeoutBanner([]);
    } finally {
        markRenderReady("sensor");
    }
}

updatePower();
updateTime();
updateLunar();
updateWarning();
renderSensors();
waitForWidgetRender();

window.addEventListener("resize", fitFestivalText);
if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fitFestivalText);
}
