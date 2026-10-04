let pName = "ผู้กล้า";
let pScore = 0;
let bScore = 0;
let winTarget = 3;
let isGameOver = false;

const em = { rock: "✊", paper: "✋", scissors: "✌️" };

function toggleModal(id) {
    document.getElementById(id).classList.toggle('hidden');
}

function resetGame() {
    document.getElementById('setup-screen').classList.remove('hidden');
    document.getElementById('game-screen').classList.add('hidden');
}

function startGame(e) {
    e.preventDefault();
    pName = document.getElementById('player-name').value.trim() || "ผู้กล้า";
    winTarget = parseInt(document.getElementById('game-level').value);
    pScore = 0;
    bScore = 0;
    isGameOver = false;

    document.getElementById('display-player-name').innerText = pName;
    document.getElementById('target-score').innerText = winTarget;
    document.getElementById('player-score').innerText = 0;
    document.getElementById('bot-score').innerText = 0;
    document.getElementById('player-choice-emoji').innerText = "❓";
    document.getElementById('bot-choice-emoji').innerText = "❓";
    
    const msg = document.getElementById('status-message');
    msg.innerText = "เริ่มศึกแล้ว! เลือกออกอาวุธได้เลย";
    msg.className = "text-sm font-bold py-3 px-4 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-xl";
    
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
}

function playTurn(pChoice) {
    if (isGameOver) return;
    
    const ch = ['rock', 'paper', 'scissors'];
    const bChoice = ch[Math.floor(Math.random() * 3)];

    document.getElementById('player-choice-emoji').innerText = em[pChoice];
    document.getElementById('bot-choice-emoji').innerText = em[bChoice];
    
    const msg = document.getElementById('status-message');

    if (pChoice === bChoice) {
        msg.innerText = `เสมอ! ต่างคนต่างออก ${em[pChoice]}`;
        msg.className = "text-sm font-bold py-3 px-4 bg-slate-700/30 text-slate-300 border border-slate-600/50 rounded-xl";
    } else if (
        (pChoice === 'rock' && bChoice === 'scissors') ||
        (pChoice === 'paper' && bChoice === 'rock') ||
        (pChoice === 'scissors' && bChoice === 'paper')
    ) {
        pScore++;
        document.getElementById('player-score').innerText = pScore;
        msg.innerText = `คุณได้แต้ม! ${em[pChoice]} ชนะ ${em[bChoice]}`;
        msg.className = "text-sm font-bold py-3 px-4 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl";
    } else {
        bScore++;
        document.getElementById('bot-score').innerText = bScore;
        msg.innerText = `บอทได้แต้ม! ${em[bChoice]} ชนะ ${em[pChoice]}`;
        msg.className = "text-sm font-bold py-3 px-4 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-xl";
    }

    checkGameStatus(msg);
}

function checkGameStatus(msg) {
    if (pScore >= winTarget) {
        msg.innerText = `🎉 คุณ ${pName} ชนะเลเวลนี้อย่างสมบูรณ์แบบ!`;
        msg.className = "text-sm font-bold py-3 px-4 bg-emerald-500 text-white rounded-xl shadow-lg";
        isGameOver = true;
    } else if (bScore >= winTarget) {
        msg.innerText = "💀 คุณพ่ายแพ้ให้กับบอทแล้ว! ลองใหม่อีกครั้ง";
        msg.className = "text-sm font-bold py-3 px-4 bg-rose-600 text-white rounded-xl shadow-lg";
        isGameOver = true;
    }
}

// ระบบคีย์บอร์ดลัด (เลข 1, 2, 3)
window.addEventListener('keydown', function (e) {
    if (document.getElementById('game-screen').classList.contains('hidden') || document.activeElement.tagName === 'INPUT') return;
    if (e.key === '1') playTurn('rock');
    else if (e.key === '2') playTurn('paper');
    else if (e.key === '3') playTurn('scissors');
});
