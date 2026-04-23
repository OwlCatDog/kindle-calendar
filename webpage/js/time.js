const appConfig = window.__APP_CONFIG__ || {};
const apiBaseUrl = (appConfig.apiBaseUrl || "http://127.0.0.1:3643").replace(/\/$/, "");

const sensorQuery = `${apiBaseUrl}/getSensor`;
const elegantSentenceQuery = `${apiBaseUrl}/elegent`;
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

        let finalAns = "";
        if (jieqi !== "") {
            finalAns += jieqi;
        }
        if (lunarFestival !== "") {
            finalAns += "&nbsp;&nbsp;" + lunarFestival;
        }
        if (festival !== "") {
            finalAns += "&nbsp;&nbsp;" + festival;
        }
        document.getElementById("festival").innerHTML = finalAns;
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
    const widgetNode = document.getElementById("ww_bc810257cf5c1");
    if (!widgetNode) {
        return true;
    }

    if (widgetNode.querySelector("iframe")) {
        return true;
    }

    const normalizedText = widgetNode.textContent.replace(/\s+/g, "").trim();
    if (normalizedText !== "" && normalizedText !== "天气插件") {
        return true;
    }

    return widgetNode.children.length > 1;
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

async function renderSensors() {
    try {
        const resp = await fetchJson(sensorQuery);
        document.getElementById("valtmew-out").innerText = resp[1].time;
        document.getElementById("valtmp-out").innerText = resp[1].temp + "°C";
        document.getElementById("valhmi-out").innerText = resp[1].humi + "%";
        document.getElementById("valtmew-in").innerText = resp[0].time;
        document.getElementById("valtmp-in").innerText = resp[0].temp + "°C";
        document.getElementById("valhmi-in").innerText = resp[0].humi + "%";
    } catch (error) {
        console.error("renderSensors failed", error);
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
