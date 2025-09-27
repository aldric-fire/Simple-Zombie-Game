import React, { useState, useEffect, useRef, useCallback } from 'react';

// NOTE: We are using standard ES module imports for a typical React file structure.
// The execution environment is assumed to handle these imports correctly.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp } from 'firebase/firestore';

// Define Global Variables expected from the Canvas environment
// These variables must be provided by the surrounding execution environment (like window.name)
// or defined here for safe execution outside of that environment.
const __app_id = typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
const __firebase_config = typeof window.__firebase_config !== 'undefined' ? window.__firebase_config : null;
const __initial_auth_token = typeof window.__initial_auth_token !== 'undefined' ? window.__initial_auth_token : null;


// --- Configuration ---
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const TIME_LIMIT = 60; // seconds
const PLAYER_MAX_HEALTH = 100; // Player's maximum health
const FIRE_RATE_MS = 200; // Minimum time between shots (milliseconds)
const HIT_COOLDOWN_FRAMES = 30; // Frames of invulnerability after taking damage (approx 0.5s)

// --- Initial Game State ---
const initialGameState = {
    isRunning: false,
    isGameOver: false,
    time: TIME_LIMIT,
    kills: 0,
    player: { 
        x: GAME_WIDTH / 2, 
        y: GAME_HEIGHT / 2, 
        size: 20, 
        speed: 5, 
        health: PLAYER_MAX_HEALTH,
        hitCooldown: 0, // Tracks invulnerability frames
    },
    enemies: [],
    bullets: [],
    spawnRate: 100, // Spawn a new zombie every 100 frames
    lastShotTime: 0, // Tracks last shot for fire rate
};

// --- Utility Functions ---

// Generate a unique ID for entities
const generateId = () => Math.random().toString(36).substring(2, 9);

// Calculate the distance between two points
const distance = (x1, y1, x2, y2) => Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

// --- Main Application Component ---
const App = () => {
    const [gameState, setGameState] = useState(initialGameState);
    const canvasRef = useRef(null);
    const frameCountRef = useRef(0);
    const animationRef = useRef();
    
    // --- Firestore States ---
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [leaderboard, setLeaderboard] = useState([]);
    // -------------------------

    // Store key state for smooth movement
    const keys = useRef({});

    // Store mouse position for aiming
    const mousePos = useRef({ x: 0, y: 0 });
    
    // --- Firebase Initialization and Authentication ---
    useEffect(() => {
        if (!__firebase_config) {
            console.error("Firebase config is missing. Cannot initialize Firestore.");
            return;
        }

        let app;
        try {
            const firebaseConfig = JSON.parse(__firebase_config);
            app = initializeApp(firebaseConfig);
        } catch (error) {
            console.error("Error parsing or initializing Firebase config:", error);
            return;
        }
        
        const dbInstance = getFirestore(app);
        const authInstance = getAuth(app);
        
        setDb(dbInstance);
        setAuth(authInstance);

        const authenticate = async () => {
            try {
                if (__initial_auth_token) {
                    await signInWithCustomToken(authInstance, __initial_auth_token);
                } else {
                    // Sign in anonymously if no custom token is available
                    await signInAnonymously(authInstance);
                }
                const currentUserId = authInstance.currentUser?.uid || crypto.randomUUID();
                setUserId(currentUserId);
            } catch (error) {
                console.error("Firebase authentication failed:", error);
            }
        };

        authenticate();
    }, []); // Run only once on mount

    // --- Firestore Operations: Save Score ---
    const saveHighScore = useCallback(async (kills, time) => {
        if (!db || !userId) return;

        const scoreData = {
            kills: kills,
            timeElapsed: TIME_LIMIT - time, // Time elapsed (better for sorting)
            userId: userId,
            timestamp: serverTimestamp(),
        };

        try {
            // Store data in the public collection path for shared leaderboards
            const leaderboardCollectionRef = collection(db, 'artifacts', __app_id, 'public', 'data', 'leaderboard');
            await addDoc(leaderboardCollectionRef, scoreData);
            console.log("Score saved successfully.");
        } catch (error) {
            console.error("Error saving score to Firestore:", error);
        }
    }, [db, userId]);

    // --- Leaderboard Listener (onSnapshot) ---
    useEffect(() => {
        if (!db || !userId) return;

        // Public collection path
        const leaderboardCollectionRef = collection(db, 'artifacts', __app_id, 'public', 'data', 'leaderboard');
        const q = query(leaderboardCollectionRef); 

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const scores = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Ensure required fields exist before adding
                if (data.kills !== undefined && data.timeElapsed !== undefined && data.userId) {
                    scores.push({ id: doc.id, ...data });
                }
            });
            
            // Sort scores in memory: higher kills first, then less time taken (lower timeElapsed is better)
            scores.sort((a, b) => {
                if (b.kills !== a.kills) {
                    return b.kills - a.kills; // Higher kills first (descending)
                }
                return a.timeElapsed - b.timeElapsed; // Less time taken is better (ascending)
            });

            // Keep only top 10
            setLeaderboard(scores.slice(0, 10)); 
        }, (error) => {
            console.error("Error fetching leaderboard:", error);
        });

        return () => unsubscribe();
    }, [db, userId]);

    // --- Input Handlers ---
    useEffect(() => {
        const handleKeyDown = (e) => { keys.current[e.key.toLowerCase()] = true; };
        const handleKeyUp = (e) => { keys.current[e.key.toLowerCase()] = false; };
        const handleMouseMove = (e) => {
            const canvas = canvasRef.current;
            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                mousePos.current.x = e.clientX - rect.left;
                mousePos.current.y = e.clientY - rect.top;
            }
        };

        const handleMouseDown = (e) => {
            if (e.button === 0 && gameState.isRunning) { // Left click
                shootBullet();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mousedown', handleMouseDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mousedown', handleMouseDown);
        };
    }, [gameState.isRunning]);


    // --- Game Logic Updates (Run in rAF loop) ---
    const updateGame = useCallback(() => {
        setGameState(prev => {
            if (!prev.isRunning || prev.isGameOver) return prev;

            const newState = { ...prev };
            newState.player = { ...prev.player };
            
            // 1. Handle Time and frame cooldown decrement
            if (frameCountRef.current % 60 === 0 && newState.time > 0) {
                newState.time -= 1;
            }
            if (newState.player.hitCooldown > 0) {
                newState.player.hitCooldown -= 1;
            }
            
            // 2. Player Movement
            let { x, y, speed } = newState.player;
            if (keys.current['w']) y -= speed;
            if (keys.current['s']) y += speed;
            if (keys.current['a']) x -= speed;
            if (keys.current['d']) x += speed;

            // Clamp player position within boundaries
            x = Math.max(newState.player.size, Math.min(GAME_WIDTH - newState.player.size, x));
            y = Math.max(newState.player.size, Math.min(GAME_HEIGHT - newState.player.size, y));
            newState.player.x = x;
            newState.player.y = y;

            // 3. Enemy Spawning
            if (frameCountRef.current % newState.spawnRate === 0) {
                const zombieSize = 15;
                const zombieSpeed = 1.5;
                
                // Spawn randomly outside the canvas bounds
                let spawnX, spawnY;
                const side = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
                
                switch (side) {
                    case 0: spawnX = Math.random() * GAME_WIDTH; spawnY = -zombieSize; break;
                    case 1: spawnX = GAME_WIDTH + zombieSize; spawnY = Math.random() * GAME_HEIGHT; break;
                    case 2: spawnX = Math.random() * GAME_WIDTH; spawnY = GAME_HEIGHT + zombieSize; break;
                    case 3: spawnX = -zombieSize; spawnY = Math.random() * GAME_HEIGHT; break;
                    default: break;
                }

                newState.enemies.push({
                    id: generateId(),
                    x: spawnX,
                    y: spawnY,
                    size: zombieSize,
                    speed: zombieSpeed + newState.kills * 0.005, // Zombies get faster as kills increase
                    health: 1,
                });
                newState.spawnRate = Math.max(20, 100 - Math.floor(newState.kills / 10) * 5); // Spawn faster
            }


            // 4. Enemy Movement & Player Collision
            const enemiesToRemove = new Set();
            newState.enemies = newState.enemies.map(enemy => {
                const angle = Math.atan2(newState.player.y - enemy.y, newState.player.x - enemy.x);
                enemy.x += Math.cos(angle) * enemy.speed;
                enemy.y += Math.sin(angle) * enemy.speed;

                // Player-Enemy Collision (now damages player and grants invulnerability)
                if (distance(newState.player.x, newState.player.y, enemy.x, enemy.y) < newState.player.size + enemy.size * 0.5) {
                    if (newState.player.hitCooldown === 0) {
                        newState.player.health = Math.max(0, newState.player.health - 25); // Take 25 damage
                        newState.player.hitCooldown = HIT_COOLDOWN_FRAMES; // Apply invulnerability
                    }
                }
                return enemy;
            }).filter(enemy => !enemiesToRemove.has(enemy.id));

            // 5. Bullet Movement & Collisions
            const newBullets = [];
            const enemiesHit = new Set();

            newState.bullets.forEach(bullet => {
                bullet.x += bullet.vx * 10; // Bullet speed multiplier
                bullet.y += bullet.vy * 10;
                
                let hit = false;
                
                // Bullet-Enemy Collision
                newState.enemies.forEach(enemy => {
                    if (!enemiesHit.has(enemy.id) && distance(bullet.x, bullet.y, enemy.x, enemy.y) < enemy.size) {
                        enemiesHit.add(enemy.id);
                        hit = true;
                        newState.kills += 1;
                    }
                });

                // Keep bullet if it hasn't hit an enemy AND is within bounds
                if (!hit && bullet.x > 0 && bullet.x < GAME_WIDTH && bullet.y > 0 && bullet.y < GAME_HEIGHT) {
                    newBullets.push(bullet);
                }
            });

            // Remove hit enemies
            newState.enemies = newState.enemies.filter(enemy => !enemiesHit.has(enemy.id));
            newState.bullets = newBullets;

            // 6. Check Player Death (after collision)
            if (newState.player.health <= 0) {
                newState.isRunning = false;
                newState.isGameOver = true;
                // Save score on death
                saveHighScore(prev.kills, prev.time); 
            }

            // 7. Check Win Condition
            if (newState.time <= 0 && newState.isRunning) {
                newState.isRunning = false;
                newState.isGameOver = true;
                // Save score on survival
                saveHighScore(prev.kills, prev.time); 
            }

            return newState;
        });

        frameCountRef.current++;
    }, [saveHighScore]);
    
    // --- Shooting Logic ---
    const shootBullet = useCallback(() => {
        const currentTime = Date.now();
        
        setGameState(prev => {
            // Check if game is running AND if cooldown is ready
            if (!prev.isRunning || prev.isGameOver || (currentTime - prev.lastShotTime < FIRE_RATE_MS)) return prev; 
            
            const player = prev.player;
            const targetX = mousePos.current.x;
            const targetY = mousePos.current.y;

            // Calculate direction vector
            const angle = Math.atan2(targetY - player.y, targetX - player.x);
            const vx = Math.cos(angle);
            const vy = Math.sin(angle);

            const newBullet = {
                id: generateId(),
                x: player.x,
                y: player.y,
                vx: vx,
                vy: vy,
                size: 5,
            };

            return {
                ...prev,
                bullets: [...prev.bullets, newBullet],
                lastShotTime: currentTime, // Update last shot time
            };
        });
    }, []);


    // --- Rendering ---
    const draw = useCallback((ctx, state) => {
        // Clear canvas (The 'night' battlefield)
        ctx.fillStyle = '#1A1A1A'; 
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

        // 1. Draw Bullets (A flash of light)
        ctx.fillStyle = '#6EE7B7'; // Teal for bullets
        state.bullets.forEach(bullet => {
            ctx.beginPath();
            ctx.arc(bullet.x, bullet.y, bullet.size, 0, Math.PI * 2);
            ctx.fill();
        });

        // 2. Draw Enemies (Zombies - Red, slow-moving threats)
        state.enemies.forEach(enemy => {
            ctx.fillStyle = '#EF4444'; // Red for zombies
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.size, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw a simplified skull/threat indicator
            ctx.fillStyle = 'black';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('💀', enemy.x, enemy.y + 3); 
        });

        // 3. Draw Player (Survivor - Blue/Teal)
        const isInvulnerable = state.player.hitCooldown > 0 && (frameCountRef.current % 6 < 3); // Flash effect
        
        // Draw player body
        if (!isInvulnerable) {
            ctx.fillStyle = '#22D3EE'; // Cyan for player
            ctx.beginPath();
            ctx.arc(state.player.x, state.player.y, state.player.size, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Draw invulnerability shield/flash
            ctx.strokeStyle = '#FCD34D'; // Yellow outline
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(state.player.x, state.player.y, state.player.size, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        // Draw player icon
        ctx.fillStyle = 'black';
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🔫', state.player.x, state.player.y + 6);
        
        // --- Draw Health Bar on Canvas (Top Left) ---
        const hpBarWidth = 150;
        const hpBarHeight = 15;
        const hpX = 20;
        const hpY = 20;
        const currentHealthRatio = state.player.health / PLAYER_MAX_HEALTH;
        const currentHpWidth = hpBarWidth * currentHealthRatio;

        // Container Border and Background
        ctx.strokeStyle = '#6366F1'; // Indigo Border
        ctx.lineWidth = 2;
        ctx.strokeRect(hpX, hpY, hpBarWidth, hpBarHeight);
        ctx.fillStyle = '#374151'; // Dark Gray Background
        ctx.fillRect(hpX, hpY, hpBarWidth, hpBarHeight);

        // Foreground (Health)
        const hpColor = currentHealthRatio > 0.5 ? '#10B981' : (currentHealthRatio > 0.25 ? '#FBBF24' : '#EF4444');
        ctx.fillStyle = hpColor;
        ctx.fillRect(hpX, hpY, currentHpWidth, hpBarHeight);
        
        // Text
        ctx.fillStyle = 'white';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`HP: ${state.player.health}%`, hpX + hpBarWidth / 2, hpY + 11);

        // 4. Draw Aiming Line and Mouse Cursor
        if (state.isRunning) {
            ctx.strokeStyle = '#FCD34D'; // Yellow for aiming
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(state.player.x, state.player.y);
            ctx.lineTo(mousePos.current.x, mousePos.current.y);
            ctx.stroke();

            // Draw a small crosshair at the mouse position
            ctx.strokeStyle = '#FCD34D';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(mousePos.current.x - 5, mousePos.current.y);
            ctx.lineTo(mousePos.current.x + 5, mousePos.current.y);
            ctx.moveTo(mousePos.current.x, mousePos.current.y - 5);
            ctx.lineTo(mousePos.current.x, mousePos.current.y + 5);
            ctx.stroke();
        }
        
        // 5. Draw Game Over / Win State
        if (state.isGameOver) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
            
            ctx.fillStyle = state.player.health <= 0 ? '#EF4444' : '#10B981';
            ctx.font = '48px Inter, sans-serif';
            ctx.textAlign = 'center';
            const message = state.player.health <= 0 ? 'MISSION FAILED' : 'SURVIVAL SUCCESSFUL!';
            ctx.fillText(message, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30);
            
            ctx.fillStyle = 'white';
            ctx.font = '24px Inter, sans-serif';
            ctx.fillText(`Zombies Neutralized: ${state.kills}`, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20);
            ctx.fillText('Click START to restart', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60);
        }

    }, [saveHighScore]);

    // --- Main Game Loop (requestAnimationFrame) ---
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        const gameLoop = () => {
            if (gameState.isRunning) {
                updateGame();
            }
            draw(ctx, gameState);
            animationRef.current = requestAnimationFrame(gameLoop);
        };

        if (gameState.isRunning || gameState.isGameOver) {
            animationRef.current = requestAnimationFrame(gameLoop);
        }
        
        return () => {
            cancelAnimationFrame(animationRef.current);
        };
    }, [gameState, updateGame, draw]);
    
    // --- Control Handlers ---
    const startGame = () => {
        setGameState({ 
            ...initialGameState, 
            isRunning: true, 
            time: TIME_LIMIT, 
            kills: 0, 
            player: { 
                ...initialGameState.player, 
                health: PLAYER_MAX_HEALTH 
            } 
        });
        frameCountRef.current = 0;
    };

    const handleStartClick = () => {
        if (!gameState.isRunning) {
            startGame();
        }
    };
    
    // Helper to format userId for display
    const formatUserId = (id) => id ? `${id.substring(0, 4)}...${id.substring(id.length - 4)}` : 'Connecting...';

    // --- Component Rendering ---
    const timeFormatted = Math.max(0, gameState.time);
    
    return (
        <div className="min-h-screen bg-gray-900 text-white font-inter flex flex-col items-center p-4">
            {/* Tailwind and Custom CSS Styles */}
            <style>
                {`
                .font-inter { font-family: 'Inter', sans-serif; }
                .game-container {
                    border: 4px solid \${gameState.isGameOver ? '#EF4444' : '#6366F1'};
                    border-radius: 1rem;
                    box-shadow: 0 0 30px \${gameState.isGameOver ? 'rgba(239, 68, 68, 0.5)' : 'rgba(99, 102, 241, 0.5)'};
                    transition: all 0.5s ease-in-out;
                    width: fit-content;
                }
                .btn-neon {
                    transition: all 0.3s ease;
                    text-shadow: 0 0 5px rgba(34, 211, 238, 0.8);
                }
                .btn-neon:hover {
                    box-shadow: 0 0 10px rgba(34, 211, 238, 0.8), 0 0 20px rgba(34, 211, 238, 0.6);
                    background-color: #22D3EE;
                    color: #111827;
                }
                .emoji-icon {
                    font-size: 1.5rem; 
                    line-height: 1;
                }
                .emoji-status {
                    font-size: 1.125rem; 
                    margin-right: 0.25rem;
                    line-height: 1;
                }
                `}
            </style>
            
            <header className="mb-6 text-center">
                <h1 className="text-5xl font-extrabold text-red-500 mb-2">
                    <span className="inline-block align-middle text-red-600 mr-2 emoji-icon">💀</span>
                    ZOMBIE INFECTION SURVIVAL
                </h1>
                <p className="text-gray-400 text-lg">Defend yourself. Survive the horde.</p>
                
                {/* User ID and Health Status Display */}
                <div className="mt-4 w-full max-w-sm mx-auto">
                    <p className="text-xs text-indigo-400 font-mono mb-1 flex items-center justify-center">
                        <span className="mr-1 text-sm">👤</span>
                        YOUR ID: {userId || 'Connecting...'}
                    </p>
                    <div className="flex justify-between text-sm font-semibold text-gray-300 mb-1">
                        <span>HEALTH:</span>
                        <span className={gameState.player.health <= 25 ? 'text-red-400' : 'text-green-400'}>
                            {gameState.player.health}%
                        </span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-3">
                        <div 
                            className={`h-3 rounded-full transition-all duration-300 
                                ${gameState.player.health > 50 ? 'bg-green-500' : gameState.player.health > 25 ? 'bg-yellow-500' : 'bg-red-500'}
                            `}
                            style={{ width: `${gameState.player.health}%` }}
                        ></div>
                    </div>
                </div>
            </header>

            {/* Game Canvas */}
            <div className="game-container">
                <canvas 
                    ref={canvasRef} 
                    width={GAME_WIDTH} 
                    height={GAME_HEIGHT} 
                    className="block rounded-lg"
                />
            </div>
            
            {/* Status Panel and Controls */}
            <div className="mt-6 w-full max-w-2xl flex flex-col items-center">
                
                {/* Status Bar */}
                <div className="w-full flex justify-between bg-gray-800 p-4 rounded-xl shadow-lg border-b-2 border-indigo-500">
                    <div className="text-center">
                        <p className="text-indigo-400 font-semibold flex items-center justify-center">
                            <span className="emoji-status">⏱️</span> TIME LEFT
                        </p>
                        <p className="text-3xl font-bold text-white mt-1">{timeFormatted}<span className="text-xl font-normal text-gray-400">s</span></p>
                    </div>
                    <div className="text-center">
                        <p className="text-indigo-400 font-semibold flex items-center justify-center">
                            <span className="emoji-status">💀</span> KILLS
                        </p>
                        <p className="text-3xl font-bold text-white mt-1">{gameState.kills}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-indigo-400 font-semibold flex items-center justify-center">
                            <span className="emoji-status">⚡</span> STATUS
                        </p>
                        <p className={`text-3xl font-bold mt-1 ${gameState.isRunning ? 'text-green-500' : gameState.isGameOver ? 'text-red-500' : 'text-yellow-500'}`}>
                            {gameState.isRunning ? 'ACTIVE' : gameState.isGameOver ? 'HALTED' : 'READY'}
                        </p>
                    </div>
                </div>

                {/* Controls and Leaderboard Container */}
                <div className="mt-6 w-full flex flex-col md:flex-row gap-6">
                    {/* Controls and Start Button */}
                    <div className="md:w-1/2 flex flex-col items-center space-y-4">
                        <button
                            onClick={handleStartClick}
                            disabled={gameState.isRunning}
                            className={`w-full max-w-sm py-4 rounded-xl font-extrabold text-xl 
                                ${gameState.isRunning 
                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed' 
                                    : 'bg-teal-500 text-gray-900 shadow-teal-500/50 btn-neon'
                                }`}
                        >
                            {gameState.isRunning ? 'SURVIVING...' : gameState.isGameOver ? 'RESTART MISSION' : 'START INFECTION'}
                        </button>
                        <p className="text-sm text-gray-500">
                            Controls: <span className="text-white font-mono">WASD</span> (Move), <span className="text-white font-mono">Mouse Click</span> (Shoot)
                        </p>
                    </div>

                    {/* Leaderboard */}
                    <div className="md:w-1/2 bg-gray-800 p-4 rounded-xl shadow-lg border-2 border-purple-500">
                        <h3 className="text-xl font-bold text-purple-400 text-center mb-3">GLOBAL LEADERBOARD (TOP 10)</h3>
                        <div className="text-sm">
                            <div className="flex justify-between font-semibold text-gray-400 border-b border-gray-700 pb-1 mb-1">
                                <span className="w-1/12">#</span>
                                <span className="w-5/12">PLAYER</span>
                                <span className="w-3/12 text-center">KILLS</span>
                                <span className="w-3/12 text-center">TIME (s)</span>
                            </div>
                            {leaderboard.length === 0 ? (
                                <p className="text-gray-500 text-center py-4">No scores yet. Be the first!</p>
                            ) : (
                                leaderboard.map((score, index) => (
                                    <div key={score.id} className={`flex justify-between py-1 px-2 rounded-lg 
                                        ${score.userId === userId ? 'bg-indigo-700 font-bold text-yellow-300' : 'text-white'}`}>
                                        <span className="w-1/12">{index + 1}</span>
                                        <span className="w-5/12">{score.userId === userId ? 'YOU' : formatUserId(score.userId)}</span>
                                        <span className="w-3/12 text-center">{score.kills}</span>
                                        <span className="w-3/12 text-center">{score.timeElapsed}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
            
            <footer className="mt-8 text-center text-gray-600 text-xs">
                Infection Protocol V2.0 | Max Health: {PLAYER_MAX_HEALTH} | Fire Rate: {FIRE_RATE_MS}ms
            </footer>
        </div>
    );
};

export default App;