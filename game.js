document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('score');
    const finalScoreEl = document.getElementById('finalScore');
    const gameOverScreen = document.getElementById('gameOverScreen');
    const restartButton = document.getElementById('restartButton');
    const startScreen = document.getElementById('startScreen');
    const startButton = document.getElementById('startButton');

    // Game settings
    let canvasWidth = 1000;
    let canvasHeight = 750;

    // Function to resize canvas
    function resizeCanvas() {
        if (window.innerWidth < 768) { // Mobile
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        } else { // Desktop
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
        }
        // Adjust player position if canvas size changes significantly
        if (player) {
            player.pos.x = Math.min(player.pos.x, canvas.width - player.size / 2);
            player.pos.y = Math.min(player.pos.y, canvas.height - player.size / 2);
        }
    }

    window.addEventListener('resize', resizeCanvas);

    // Game state
    let player, projectiles, particles, items, score, gameOver, gameLoopId;
    let projectileInterval, itemInterval, difficultyTimer;
    let audioCtx, bgmInterval;
    let projectileSpeedModifier = 1;

    // Touch/Click movement variables
    let targetX = -1;
    let targetY = -1;
    let isTouching = false;

    // --- SOUNDS ---
    function setupAudio() {
        if (audioCtx) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    function playSound(type) {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        gainNode.gain.setValueAtTime(0.1, now);

        switch (type) {
            case 'item':
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(880, now);
                gainNode.gain.exponentialRampToValueAtTime(0.00001, now + 0.4);
                break;
            case 'split':
                oscillator.type = 'sawtooth';
                oscillator.frequency.setValueAtTime(300, now);
                gainNode.gain.exponentialRampToValueAtTime(0.00001, now + 0.3);
                break;
            case 'gameOver':
                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(150, now);
                oscillator.frequency.exponentialRampToValueAtTime(50, now + 1);
                gainNode.gain.exponentialRampToValueAtTime(0.00001, now + 1);
                break;
            case 'bgm':
                const notes = [261, 293, 329, 261]; // C4, D4, E4, C4
                notes.forEach((note, i) => {
                    const osc = audioCtx.createOscillator();
                    const g = audioCtx.createGain();
                    osc.type = 'sine';
                    g.gain.setValueAtTime(0.04, now + i * 0.5);
                    osc.frequency.setValueAtTime(note, now + i * 0.5);
                    g.gain.exponentialRampToValueAtTime(0.00001, now + (i + 1) * 0.5);
                    osc.connect(g).connect(audioCtx.destination);
                    osc.start(now + i * 0.5);
                    osc.stop(now + (i + 1) * 0.5);
                });
                return; // BGM doesn't use the main oscillator
        }
        oscillator.connect(gainNode).connect(audioCtx.destination);
        oscillator.start(now);
        oscillator.stop(now + 1);
    }

    // --- UTILITY CLASSES ---
    class Vector {
        constructor(x, y) { this.x = x; this.y = y; }
        get magnitude() { return Math.sqrt(this.x ** 2 + this.y ** 2); }
        normalize() { const m = this.magnitude; if (m > 0) { this.x /= m; this.y /= m; } return this; }
    }

    // --- GAME OBJECT CLASSES ---
    class Player {
        constructor(x, y, size, color, speed) {
            this.pos = new Vector(x, y);
            this.size = size;
            this.baseColor = color;
            this.color = color;
            this.baseSpeed = speed;
            this.speed = speed;
            this.invincible = false;
        }

        draw() {
            // Draw shield if invincible
            if (this.invincible) {
                ctx.save();
                ctx.fillStyle = "rgba(255, 215, 0, 0.3)"; // Semi-transparent gold
                ctx.beginPath();
                const shieldRadius = this.size * (1.8 + Math.sin(Date.now() / 150) * 0.2); // Pulsating effect
                ctx.arc(this.pos.x, this.pos.y, shieldRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // Draw player triangle
            ctx.fillStyle = this.invincible ? `hsl(${Date.now() / 10 % 360}, 100%, 75%)` : this.color;
            ctx.beginPath();
            const angle = -Math.PI / 2; // Point upwards
            ctx.moveTo(this.pos.x + Math.cos(angle) * this.size, this.pos.y + Math.sin(angle) * this.size);
            ctx.lineTo(this.pos.x + Math.cos(angle + 2 * Math.PI / 3) * this.size, this.pos.y + Math.sin(angle + 2 * Math.PI / 3) * this.size);
            ctx.lineTo(this.pos.x + Math.cos(angle + 4 * Math.PI / 3) * this.size, this.pos.y + Math.sin(angle + 4 * Math.PI / 3) * this.size);
            ctx.closePath();
            ctx.fill();
        }

        update(keys) {
            // Keyboard movement
            if (keys.w || keys.ArrowUp) this.pos.y -= this.speed;
            if (keys.a || keys.ArrowLeft) this.pos.x -= this.speed;
            if (keys.s || keys.ArrowDown) this.pos.y += this.speed;
            if (keys.d || keys.ArrowRight) this.pos.x += this.speed;

            // Touch/Click movement
            if (isTouching && targetX !== -1 && targetY !== -1) {
                const dx = targetX - this.pos.x;
                const dy = targetY - this.pos.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance > this.speed) {
                    this.pos.x += (dx / distance) * this.speed;
                    this.pos.y += (dy / distance) * this.speed;
                } else {
                    this.pos.x = targetX;
                    this.pos.y = targetY;
                }
            }
            this.checkBounds();
        }

        activatePowerUp(type) {
            playSound('item');
            if (type === 'speed') {
                projectileSpeedModifier = 0.5;
                setTimeout(() => { projectileSpeedModifier = 1; }, 5000); // 5 seconds
            } else if (type === 'invincible') {
                this.invincible = true;
                setTimeout(() => { this.invincible = false; }, 3000); // 3 seconds
            } else if (type === 'clear') {
                // Create explosion particles from each projectile
                for (const p of projectiles) {
                    for (let i = 0; i < 10; i++) {
                        const v = new Vector((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
                        particles.push(new Particle(p.pos.x, p.pos.y, Math.random() * 2, p.color, v));
                    }
                }
                projectiles.length = 0; // Clear all projectiles
            }
        }

        checkBounds() {
            const halfSize = this.size / 2;
            if (this.pos.x < halfSize) this.pos.x = halfSize;
            if (this.pos.x > canvas.width - halfSize) this.pos.x = canvas.width - halfSize;
            if (this.pos.y < halfSize) this.pos.y = halfSize;
            if (this.pos.y > canvas.height - halfSize) this.pos.y = canvas.height - halfSize;
        }
    }

    class Projectile {
        constructor(x, y, r, c, v) { this.pos = new Vector(x, y); this.radius = r; this.color = c; this.velocity = v; }
        draw() { ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2); ctx.fill(); }
        update() { this.pos.x += this.velocity.x * projectileSpeedModifier; this.pos.y += this.velocity.y * projectileSpeedModifier; }
    }

    class CurvedProjectile extends Projectile {
        constructor(x, y, r, c, v) { super(x, y, r, c, v); this.time = 0; this.curve = (Math.random() - 0.5) * 0.2; }
        update() { this.time++; const angle = Math.atan2(this.velocity.y, this.velocity.x) + this.curve * Math.sin(this.time * 0.05); const speed = this.velocity.magnitude; this.velocity.x = Math.cos(angle) * speed; this.velocity.y = Math.sin(angle) * speed; super.update(); }
    }

    class HomingProjectile extends Projectile {
        constructor(x, y, r, c, v) { super(x, y, r, c, v); this.time = 0; this.homingDuration = 180; }
        update() { if (this.time < this.homingDuration) { const dir = new Vector(player.pos.x - this.pos.x, player.pos.y - this.pos.y).normalize(); const speed = this.velocity.magnitude; this.velocity.x = dir.x * speed; this.velocity.y = dir.y * speed; } this.time++; super.update(); }
    }

    class SplittingProjectile extends Projectile {
        constructor(x, y, r, c, v) { super(x, y, r, c, v); this.time = 0; this.splitTime = Math.random() * 120 + 60; }
        update() { this.time++; if (this.time > this.splitTime) { this.split(); this.pos.x = -9999; } super.update(); }
        split() { playSound('split'); for (let i = 0; i < 5; i++) { const angle = (Math.PI * 2 / 5) * i; const speed = this.velocity.magnitude * 1.2; const newVel = new Vector(Math.cos(angle) * speed, Math.sin(angle) * speed); projectiles.push(new Projectile(this.pos.x, this.pos.y, 3, 'pink', newVel)); } }
    }

    class Item {
        constructor(x, y, size, type) {
            this.pos = new Vector(x, y);
            this.size = size;
            this.type = type;
            switch(type) {
                case 'speed': this.symbol = 'S'; this.color = '#00BFFF'; break;
                case 'invincible': this.symbol = 'I'; this.color = '#FFD700'; break;
                case 'clear': this.symbol = 'C'; this.color = '#FFFFFF'; break;
            }
        }
        draw() { ctx.fillStyle = this.color; ctx.font = `bold ${this.size}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(this.symbol, this.pos.x, this.pos.y); }
    }

    class Particle {
        constructor(x, y, r, c, v) { this.pos = new Vector(x, y); this.radius = r; this.color = c; this.velocity = v; this.alpha = 1; }
        draw() { ctx.save(); ctx.globalAlpha = this.alpha; ctx.fillStyle = this.color; ctx.beginPath(); ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        update() { this.pos.x += this.velocity.x; this.pos.y += this.velocity.y; this.alpha -= 0.02; }
    }

    // --- GAME LOGIC ---
    function init() {
        player = new Player(canvas.width / 2, canvas.height / 2, 15, 'cyan', 5);
        projectiles = []; particles = []; items = [];
        score = 0; gameOver = false;
        projectileBaseSpeed = 2; projectileSpawnRate = 1000;
        projectileSpeedModifier = 1; // Reset modifier on new game
        scoreEl.innerText = 0;
        gameOverScreen.style.display = 'none';
        startScreen.style.display = 'block'; // Show start screen

        particles = [];
        for (let i = 0; i < 100; i++) {
            particles.push(new Particle(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 1.5, 'white', new Vector(0, 0)));
        }

        [projectileInterval, itemInterval, difficultyTimer, bgmInterval, gameLoopId].forEach(clearInterval);
        if (gameLoopId) cancelAnimationFrame(gameLoopId);

        // Initial canvas resize
        resizeCanvas();

        // Remove previous event listeners to prevent duplicates
        canvas.removeEventListener('mousedown', handleCanvasInput);
        canvas.removeEventListener('mousemove', handleCanvasInput);
        canvas.removeEventListener('mouseup', handleCanvasInputEnd);
        canvas.removeEventListener('touchstart', handleCanvasInput);
        canvas.removeEventListener('touchmove', handleCanvasInput);
        canvas.removeEventListener('touchend', handleCanvasInputEnd);

        // Add event listeners for game input
        canvas.addEventListener('mousedown', handleCanvasInput);
        canvas.addEventListener('mousemove', handleCanvasInput);
        canvas.addEventListener('mouseup', handleCanvasInputEnd);
        canvas.addEventListener('touchstart', handleCanvasInput);
        canvas.addEventListener('touchmove', handleCanvasInput);
        canvas.addEventListener('touchend', handleCanvasInputEnd);

        // Keyboard input (still active for desktop)
        window.addEventListener('keydown', handleKeyboardInput);
        window.addEventListener('keyup', handleKeyboardInputEnd);

        // Start button listener
        startButton.addEventListener('click', startGame);
        restartButton.addEventListener('click', init);
    }

    function startGame() {
        startScreen.style.display = 'none'; // Hide start screen
        setupAudio();
        bgmInterval = setInterval(() => playSound('bgm'), 2000);

        projectileInterval = setInterval(spawnProjectile, projectileSpawnRate);
        itemInterval = setInterval(spawnItem, 10000);
        difficultyTimer = setInterval(increaseDifficulty, 5000);
        gameLoop();
    }

    const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };

    function handleKeyboardInput(e) {
        if (e.key in keys) { e.preventDefault(); keys[e.key] = true; }
    }

    function handleKeyboardInputEnd(e) {
        if (e.key in keys) { e.preventDefault(); keys[e.key] = false; }
    }

    function handleCanvasInput(e) {
        e.preventDefault(); // Prevent scrolling
        isTouching = true;
        const rect = canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e.touches) { // Touch event
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else { // Mouse event
            clientX = e.clientX;
            clientY = e.clientY;
        }

        targetX = clientX - rect.left;
        targetY = clientY - rect.top;
    }

    function handleCanvasInputEnd(e) {
        e.preventDefault(); // Prevent scrolling
        isTouching = false;
        targetX = -1;
        targetY = -1;
    }

    function spawnProjectile() {
        if (gameOver) return;
        const r = Math.random() * 10 + 5;
        let x, y;
        const side = Math.floor(Math.random() * 4);
        if (side === 0) { x = Math.random() * canvas.width; y = 0 - r; }
        else if (side === 1) { x = canvas.width + r; y = Math.random() * canvas.height; }
        else if (side === 2) { x = Math.random() * canvas.width; y = canvas.height + r; }
        else { x = 0 - r; y = Math.random() * canvas.height; }

        const angle = Math.atan2(player.pos.y - y, player.pos.x - x);
        const vel = new Vector(Math.cos(angle) * projectileBaseSpeed, Math.sin(angle) * projectileBaseSpeed);
        const rand = Math.random();

        if (score > 5000 && rand < 0.15) projectiles.push(new SplittingProjectile(x, y, 12, 'purple', vel));
        else if (score > 2000 && rand < 0.15) projectiles.push(new HomingProjectile(x, y, 8, 'lightgreen', vel));
        else if (rand < 0.25) projectiles.push(new CurvedProjectile(x, y, r, 'yellow', vel));
        else projectiles.push(new Projectile(x, y, r, 'red', vel));
    }

    function spawnItem() {
        if (gameOver) return;
        const rand = Math.random();
        let type;
        if (rand < 0.1) { // 10% chance for Clear
            type = 'clear';
        } else if (rand < 0.55) { // 45% chance for Invincible
            type = 'invincible';
        } else { // 45% chance for Speed
            type = 'speed';
        }
        items.push(new Item(Math.random() * (canvas.width - 60) + 30, Math.random() * (canvas.height - 60) + 30, 20, type));
    }

    function checkCollisions() {
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            if (Math.hypot(player.pos.x - p.pos.x, player.pos.y - p.pos.y) - p.radius - player.size / 2 < 1) {
                if (player.invincible) {
                    projectiles.splice(i, 1); // Remove projectile if player is invincible
                } else {
                    return true; // Game over if not invincible
                }
            }
        }

        for (let i = items.length - 1; i >= 0; i--) {
            if (Math.hypot(player.pos.x - items[i].pos.x, player.pos.y - items[i].pos.y) < player.size / 2 + items[i].size / 2) {
                player.activatePowerUp(items[i].type);
                items.splice(i, 1);
            }
        }
        return false;
    }

    function increaseDifficulty() {
        if (gameOver) return;
        projectileBaseSpeed *= 1.05;
        projectileSpawnRate = Math.max(150, projectileSpawnRate * 0.95);
        clearInterval(projectileInterval);
        projectileInterval = setInterval(spawnProjectile, projectileSpawnRate);
    }

    function gameLoop() {
        if (gameOver) {
            playSound('gameOver');
            finalScoreEl.innerText = score;
            gameOverScreen.style.display = 'block';
            [projectileInterval, itemInterval, difficultyTimer, bgmInterval].forEach(clearInterval);
            return;
        }

        gameLoopId = requestAnimationFrame(gameLoop);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        particles.forEach((p, i) => { p.update(); p.draw(); if (p.alpha <= 0) particles.splice(i, 1); });
        items.forEach((item, i) => { item.draw(); });
        projectiles.forEach((p, i) => { p.update(); p.draw(); if (p.pos.x < -20 || p.pos.x > canvas.width + 20 || p.pos.y < -20 || p.pos.y > canvas.height + 20) projectiles.splice(i, 1); });
        player.update(keys);
        player.draw();
        
        if (checkCollisions()) gameOver = true;
        
        score++;
        scoreEl.innerText = score;
    }

    restartButton.addEventListener('click', init);

    init();
});