export function LaundryAnimation() {
  return (
    <div className="w-full max-w-2xl mx-auto">
      <svg viewBox="0 0 800 400" className="w-full h-auto">
        {/* Background */}
        <rect width="800" height="400" fill="hsl(var(--background))" />
        
        {/* Floor */}
        <rect y="320" width="800" height="80" fill="hsl(var(--muted))" />
        
        {/* Washing Machines */}
        <g id="machine1">
          <rect x="50" y="200" width="120" height="120" rx="10" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
          <circle cx="110" cy="260" r="35" fill="hsl(var(--primary) / 0.2)" stroke="hsl(var(--primary))" strokeWidth="3">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 110 260"
              to="360 110 260"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="110" cy="260" r="25" fill="none" stroke="hsl(var(--primary))" strokeWidth="2" opacity="0.5" />
        </g>
        
        <g id="machine2">
          <rect x="200" y="200" width="120" height="120" rx="10" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
          <circle cx="260" cy="260" r="35" fill="hsl(var(--accent) / 0.2)" stroke="hsl(var(--accent))" strokeWidth="3">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 260 260"
              to="-360 260 260"
              dur="2.5s"
              repeatCount="indefinite"
            />
          </circle>
          <circle cx="260" cy="260" r="25" fill="none" stroke="hsl(var(--accent))" strokeWidth="2" opacity="0.5" />
        </g>
        
        {/* Dryer */}
        <g id="dryer">
          <rect x="350" y="200" width="120" height="120" rx="10" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
          <circle cx="410" cy="260" r="35" fill="hsl(var(--secondary))" stroke="hsl(var(--border))" strokeWidth="3" />
          <path d="M 410 235 Q 420 250 410 265 Q 400 250 410 235" fill="hsl(var(--primary))" opacity="0.6">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 410 260"
              to="360 410 260"
              dur="2s"
              repeatCount="indefinite"
            />
          </path>
        </g>
        
        {/* Worker 1 - Person at washing machine */}
        <g id="worker1">
          {/* Body */}
          <ellipse cx="110" cy="180" rx="20" ry="30" fill="hsl(var(--primary))">
            <animate attributeName="ry" values="30;32;30" dur="2s" repeatCount="indefinite" />
          </ellipse>
          {/* Head */}
          <circle cx="110" cy="140" r="15" fill="hsl(215 25% 70%)" />
          {/* Hair */}
          <path d="M 95 135 Q 110 125 125 135" fill="hsl(215 25% 30%)" />
          {/* Arms */}
          <line x1="90" y1="165" x2="70" y2="185" stroke="hsl(215 25% 70%)" strokeWidth="6" strokeLinecap="round">
            <animate attributeName="x2" values="70;65;70" dur="2s" repeatCount="indefinite" />
            <animate attributeName="y2" values="185;190;185" dur="2s" repeatCount="indefinite" />
          </line>
          <line x1="130" y1="165" x2="150" y2="185" stroke="hsl(215 25% 70%)" strokeWidth="6" strokeLinecap="round">
            <animate attributeName="x2" values="150;155;150" dur="2s" repeatCount="indefinite" />
            <animate attributeName="y2" values="185;190;185" dur="2s" repeatCount="indefinite" />
          </line>
          {/* Legs */}
          <line x1="105" y1="210" x2="100" y2="240" stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round" />
          <line x1="115" y1="210" x2="120" y2="240" stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round" />
        </g>
        
        {/* Worker 2 - Person folding clothes */}
        <g id="worker2">
          <animate attributeName="transform" values="translate(0,0);translate(0,-5);translate(0,0)" dur="3s" repeatCount="indefinite" />
          {/* Body */}
          <ellipse cx="580" cy="180" rx="20" ry="30" fill="hsl(var(--accent))" />
          {/* Head */}
          <circle cx="580" cy="140" r="15" fill="hsl(215 25% 65%)" />
          {/* Hair */}
          <ellipse cx="580" cy="130" rx="18" ry="12" fill="hsl(30 40% 40%)" />
          {/* Arms - folding motion */}
          <line x1="560" y1="165" x2="540" y2="180" stroke="hsl(215 25% 65%)" strokeWidth="6" strokeLinecap="round">
            <animate attributeName="x2" values="540;545;540" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="180;175;180" dur="1.5s" repeatCount="indefinite" />
          </line>
          <line x1="600" y1="165" x2="620" y2="180" stroke="hsl(215 25% 65%)" strokeWidth="6" strokeLinecap="round">
            <animate attributeName="x2" values="620;615;620" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="y2" values="180;175;180" dur="1.5s" repeatCount="indefinite" />
          </line>
          {/* Legs */}
          <line x1="575" y1="210" x2="570" y2="240" stroke="hsl(var(--accent))" strokeWidth="8" strokeLinecap="round" />
          <line x1="585" y1="210" x2="590" y2="240" stroke="hsl(var(--accent))" strokeWidth="8" strokeLinecap="round" />
        </g>
        
        {/* Folding Table */}
        <rect x="520" y="240" width="120" height="10" rx="2" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
        <rect x="525" y="250" width="5" height="70" fill="hsl(var(--border))" />
        <rect x="635" y="250" width="5" height="70" fill="hsl(var(--border))" />
        
        {/* Clothes on table */}
        <rect x="530" y="225" width="30" height="15" rx="2" fill="hsl(200 80% 60%)" opacity="0.8" />
        <rect x="570" y="225" width="30" height="15" rx="2" fill="hsl(340 80% 60%)" opacity="0.8" />
        <rect x="610" y="225" width="25" height="15" rx="2" fill="hsl(120 60% 60%)" opacity="0.8" />
        
        {/* Laundry Basket */}
        <g id="basket">
          <path d="M 680 280 L 700 280 L 710 310 L 670 310 Z" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
          <ellipse cx="690" cy="275" rx="15" ry="8" fill="hsl(340 70% 60%)" opacity="0.7" />
          <ellipse cx="695" cy="270" rx="12" ry="6" fill="hsl(200 70% 60%)" opacity="0.7" />
        </g>
        
        {/* Bubbles */}
        <circle cx="130" cy="190" r="4" fill="hsl(var(--primary) / 0.4)">
          <animate attributeName="cy" values="190;160;190" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.8;0.4" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="145" cy="200" r="3" fill="hsl(var(--primary) / 0.4)">
          <animate attributeName="cy" values="200;170;200" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.5s" repeatCount="indefinite" />
        </circle>
        <circle cx="280" cy="195" r="5" fill="hsl(var(--accent) / 0.4)">
          <animate attributeName="cy" values="195;165;195" dur="2.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2.8s" repeatCount="indefinite" />
        </circle>
        
        {/* Steam from dryer */}
        <path d="M 430 190 Q 435 180 430 170" stroke="hsl(var(--muted-foreground))" strokeWidth="2" fill="none" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2s" repeatCount="indefinite" />
        </path>
        <path d="M 440 195 Q 445 185 440 175" stroke="hsl(var(--muted-foreground))" strokeWidth="2" fill="none" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.6;0.3" dur="2.2s" repeatCount="indefinite" />
        </path>
      </svg>
    </div>
  );
}
