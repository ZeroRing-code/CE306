```javascript
const exchangeRate = 35.50;

let historyData =
JSON.parse(localStorage.getItem("currencyHistory")) || [];

showHistory();
showUpdateTime();

function convertTHBtoUSD(){

    const thb =
    parseFloat(document.getElementById("thb").value);

    if(isNaN(thb)){
        alert("กรุณากรอกจำนวนเงินบาท");
        return;
    }

    const usd =
    (thb / exchangeRate).toFixed(2);

    document.getElementById("usd").value = usd;

    addHistory(
        `${thb.toLocaleString()} THB ➜ ${usd} USD`
    );
}

function convertUSDtoTHB(){

    const usd =
    parseFloat(document.getElementById("usd").value);

    if(isNaN(usd)){
        alert("กรุณากรอกจำนวน USD");
        return;
    }

    const thb =
    (usd * exchangeRate).toFixed(2);

    document.getElementById("thb").value = thb;

    addHistory(
        `${usd} USD ➜ ${Number(thb).toLocaleString()} THB`
    );
}

function addHistory(text){

    historyData.unshift(text);

    if(historyData.length > 10){
        historyData.pop();
    }

    localStorage.setItem(
        "currencyHistory",
        JSON.stringify(historyData)
    );

    showHistory();
}

function showHistory(){

    const historyList =
    document.getElementById("historyList");

    historyList.innerHTML = "";

    historyData.forEach(item => {

        const li =
        document.createElement("li");

        li.textContent = item;

        historyList.appendChild(li);
    });
}

function clearData(){

    document.getElementById("thb").value = "";
    document.getElementById("usd").value = "";

    document.getElementById("thb").focus();
}

function showUpdateTime(){

    const now = new Date();

    document.getElementById("updateTime").innerHTML =
    "อัปเดตอัตราแลกเปลี่ยนล่าสุด : " +
    now.toLocaleString("th-TH");
}