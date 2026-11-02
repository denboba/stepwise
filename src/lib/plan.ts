export type ProofKind = "check" | "text" | "passfail" | "number" | "photo";

export interface ProofItem {
  id: string;
  label: string;
  kind: ProofKind;
  /** Optional bounds for number items (inclusive). */
  min?: number | undefined;
  max?: number | undefined;
}

export interface Step {
  id: string;
  title: string;
  minutes: number;
  prereqs: string[];
  safety?: string;
  actions: string[];
  proof: ProofItem[];
  hint: string;
  why: string;
  /** Optional recap line; {itemId} is replaced by that proof value. */
  recap?: string;
  /** Optional wait time the AI plan asks for before the next step (seconds). */
  waitSeconds?: number;
}

/** Goal check: either "after >= baseline + rise", or a set of pass/fail items that must all pass. */
export type GoalCheck =
  | { kind: "rise"; label: string; baseStep: string; baseItem: string; rise: number }
  | { kind: "passfail"; items: ProofItem[] };

export interface Plan {
  id: string;
  /** Short name for the goal list and goal card. */
  title: string;
  goal: string;
  doneMeans: string;
  /**
   * Match phrases that pick this plan from typed text (see `planForText`). Every word of one phrase must
   * appear as a whole word; a trailing "*" allows a prefix. Keep them specific: a miss uses the AI intake.
   */
  keywords: string[];
  steps: Step[];
  check: GoalCheck;
}

export const PHONE_PLAN: Plan = {
  id: "phone",
  title: "Phone charges normally",
  goal: "phone charges normally",
  keywords: ["phone charg*", "iphone charg*", "android charg*"],
  doneMeans:
    "Charging icon appears within 5 minutes and battery rises at least 5 percent in 30 minutes.",
  check: {
    kind: "rise",
    label: "Battery percent after 30 minutes",
    baseStep: "s5",
    baseItem: "before",
    rise: 5,
  },
  steps: [
    {
      id: "s1",
      title: "Safety check and gather tools",
      minutes: 10,
      prereqs: [],
      safety: "Never put metal tools in the charging port. Stop if the phone feels hot or swollen.",
      actions: [
        "Switch the phone off.",
        "Clear a dry, well-lit space.",
        "Get a flashlight and a wooden toothpick.",
      ],
      proof: [
        { id: "off", label: "Phone is off", kind: "check" },
        { id: "space", label: "Workspace is dry and lit", kind: "check" },
        { id: "tools", label: "Tools in hand", kind: "check" },
      ],
      hint: "A sewing needle works if you have no toothpick, but use wood or plastic only near the port.",
      why: "A powered-off phone and the right tools keep the port and you safe.",
      recap: "Step {n}: phone off, workspace ready, tools in hand.",
    },
    {
      id: "s2",
      title: "Inspect the charging port",
      minutes: 5,
      prereqs: ["s1"],
      actions: [
        "Shine the flashlight into the port.",
        "Look for lint, debris, bent pins or green corrosion.",
      ],
      proof: [
        { id: "looked", label: "I looked into the port", kind: "check" },
        { id: "saw", label: "I noted what I saw", kind: "text" },
      ],
      hint: "Tilt the phone slowly under the light; lint looks like a grey felt layer at the back.",
      why: "Most charging failures are a blocked or damaged port.",
      recap: 'Step {n}: port inspected, saw "{saw}".',
    },
    {
      id: "s3",
      title: "Test the cable and charger on another device",
      minutes: 10,
      prereqs: ["s1"],
      actions: [
        "Plug your cable into another phone or device.",
        "Plug a different cable into your charger.",
      ],
      proof: [
        { id: "cable", label: "Cable tested elsewhere", kind: "passfail" },
        { id: "charger", label: "Charger tested with another cable", kind: "passfail" },
      ],
      hint: "Borrow a cable from a friend or try a laptop USB port as the other device.",
      why: "Rules out the cable and charger before blaming the phone.",
      recap: "Step {n}: cable {cable}, charger {charger}.",
    },
    {
      id: "s4",
      title: "Clean the charging port",
      minutes: 10,
      prereqs: ["s2"],
      actions: ["Gently scrape out lint with the toothpick.", "Blow out dust."],
      proof: [
        { id: "lint", label: "Lint removed", kind: "check" },
        { id: "clear", label: "Port looks clear", kind: "check" },
      ],
      hint: "Scrape along the back wall, not the pins, and pull the lint outward.",
      why: "Packed lint stops the plug from seating fully.",
      recap: "Step {n}: port cleaned and clear.",
    },
    {
      id: "s5",
      title: "Start a 30-minute charge test",
      minutes: 35,
      prereqs: ["s3", "s4"],
      waitSeconds: 1800,
      actions: [
        "Note the battery percent, then connect a known-good cable and charger.",
        "Start the 30-minute timer and leave the phone charging.",
        "When it ends, photograph the battery screen showing percent and charging icon.",
      ],
      proof: [
        { id: "before", label: "Battery percent before", kind: "number" },
        { id: "icon", label: "Charging icon appeared within 5 minutes", kind: "check" },
        {
          id: "screen",
          label: "Photo of the battery screen showing percent and charging icon",
          kind: "photo",
        },
      ],
      hint: "If the phone is fully drained, the icon can take a few minutes to show.",
      why: "A timed test shows whether the fix actually holds.",
      recap: "Step {n}: charge test started at {before}%.",
    },
  ],
};

const c = (id: string, label: string): ProofItem => ({ id, label, kind: "check" });
const t = (id: string, label: string): ProofItem => ({ id, label, kind: "text" });
const pf = (id: string, label: string): ProofItem => ({ id, label, kind: "passfail" });
const n = (id: string, label: string, min?: number, max?: number): ProofItem => ({
  id,
  label,
  kind: "number",
  min,
  max,
});

export const WEBSITE_PLAN: Plan = {
  id: "website",
  title: "Simple website",
  goal: "A one-page website for my small business, live on a public link.",
  doneMeans:
    "The public link opens on a phone using mobile data, and a test message sent through the contact form reaches me.",
  keywords: ["website", "web site", "webpage", "web page", "landing page"],
  steps: [
    {
      id: "w1",
      title: "Define purpose and audience",
      minutes: 15,
      prereqs: [],
      actions: [
        "Write one sentence on who the site is for and what they should do.",
        "List the 3 things visitors must find.",
      ],
      proof: [t("purpose", "Purpose sentence"), t("mustfind", "The 3 must-find items")],
      hint: 'Finish this sentence: "This site helps ___ to ___." Must-find items are often prices, opening hours and how to contact you.',
      why: "Knowing who it's for tells you what goes on the page and what to leave out.",
    },
    {
      id: "w2",
      title: "Collect your real content",
      minutes: 30,
      prereqs: ["w1"],
      actions: [
        "Write a headline and a 2-sentence description.",
        "List what you offer and gather at least 3 photos.",
        "Note your contact details.",
      ],
      proof: [
        c("headline", "Headline written"),
        n("photos", "Photos ready (at least 3)", 3),
        c("contact", "Contact details ready"),
      ],
      hint: "Phone photos are fine. Take them in daylight, near a window, of your work or your shop.",
      why: "Real words and photos make the site feel trustworthy; placeholders don't.",
    },
    {
      id: "w3",
      title: "Choose name and look",
      minutes: 15,
      prereqs: ["w1"],
      actions: [
        "Pick the site name.",
        "Pick 2 colors and 3 mood words (for example warm, trustworthy, simple).",
      ],
      proof: [t("name", "Site name"), t("look", "Colors and mood words")],
      hint: "Your business name is usually the best site name. Take your colors from your sign, logo or shop front.",
      why: "A clear name and look make the site easy to recognise and remember.",
    },
    {
      id: "w4",
      title: "Check domain availability",
      minutes: 10,
      prereqs: ["w3"],
      actions: [
        "Search a domain registrar for 2 names based on your site name.",
        "Shortlist the available ones.",
      ],
      proof: [t("shortlist", "Shortlist"), pf("available", "At least one name available")],
      hint: "If your name is taken, try adding your town or what you do, for example yournamebakery.",
      why: "Your web address is how people find you, so pick one that's free and easy to type.",
    },
    {
      id: "w5",
      title: "Sketch the page layout",
      minutes: 20,
      prereqs: ["w2", "w3"],
      actions: [
        "Order the sections: top banner, what you offer, proof (photos or reviews), contact.",
        "Give every must-find item a place.",
      ],
      proof: [
        t("sections", "Sections listed in order"),
        c("placed", "Every must-find item has a place"),
      ],
      hint: "Draw 4 boxes on paper, top to bottom, and write one section name in each box.",
      why: "A simple plan on paper saves you from rebuilding the page later.",
    },
    {
      id: "w6",
      title: "Build the page",
      minutes: 60,
      prereqs: ["w5"],
      actions: ["Build the one-page site using your real content."],
      proof: [
        c("real", "Real headline, offer and photos are on the page"),
        pf("preview", "Page opens in the preview"),
      ],
      hint: "Build one section at a time, top to bottom, following your sketch.",
      why: "This is where your plan turns into a page people can actually see.",
    },
    {
      id: "w7",
      title: "Test on phone and laptop",
      minutes: 15,
      prereqs: ["w6"],
      actions: [
        "Open it on a phone and a laptop.",
        "Click every button and link.",
        "Submit the contact form once.",
      ],
      proof: [
        pf("phone", "Phone looks right"),
        pf("laptop", "Laptop looks right"),
        pf("links", "All buttons and links work"),
      ],
      hint: "Ask a friend to try it on their phone and tell you anything that looks odd.",
      why: "Most visitors will use a phone, so it has to work there first.",
    },
    {
      id: "w8",
      title: "Publish the site",
      minutes: 20,
      prereqs: ["w4", "w7"],
      actions: ["Publish the site and copy the public link."],
      proof: [c("published", "Published"), t("link", "Public link pasted")],
      hint: "The link usually starts with https://. Copy it from your browser's address bar after you publish.",
      why: "Until it's published, nobody else can see your site.",
    },
  ],
  check: {
    kind: "passfail",
    items: [
      pf("mobile", "Opened the public link on a phone using mobile data"),
      pf("form", "Test message through the contact form reached me"),
    ],
  },
};

export const ROBOT_PLAN: Plan = {
  id: "robot",
  title: "Line-following robot",
  goal: "A robot that follows a black line on the floor for 2 meters without leaving it.",
  doneMeans:
    "The robot completes a 2-meter black-tape track in 3 out of 3 runs without leaving the line.",
  keywords: ["line follow*"],
  steps: [
    {
      id: "r1",
      title: "Safety check and parts check",
      minutes: 15,
      prereqs: [],
      safety:
        "Disconnect the battery whenever you change wiring. Never short the battery terminals. Work on a flat, non-flammable surface.",
      actions: [
        "Clear a flat table.",
        "Lay out the board, 2 motors with wheels, motor driver, 2 line sensors, battery pack, chassis and jumper wires.",
      ],
      proof: [c("parts", "All parts on the table"), c("battery", "Battery pack disconnected")],
      hint: "Check each part off against your kit's parts list. A missing part is easier to spot now than later.",
      why: "Starting safe with every part in front of you avoids damage and lost time.",
    },
    {
      id: "r2",
      title: "Build chassis, mount motors and wheels",
      minutes: 30,
      prereqs: ["r1"],
      actions: [
        "Fix the motors to the chassis.",
        "Attach the wheels.",
        "Add the caster or ball wheel at the back.",
      ],
      proof: [c("motors", "Motors fixed firmly"), pf("spin", "Wheels spin freely by hand")],
      hint: "If a wheel rubs, loosen its screw slightly or move the wheel a little further out on the shaft.",
      why: "A solid base drives straight, which makes following the line much easier.",
    },
    {
      id: "r3",
      title: "Lay the 2-meter test track",
      minutes: 10,
      prereqs: ["r1"],
      actions: ["Stick 2 meters of black tape on a light floor with one gentle curve."],
      proof: [
        n("length", "Track length in cm (at least 200)", 200),
        c("contrast", "Tape contrasts clearly with the floor"),
      ],
      hint: "Electrical tape on a light floor or a big sheet of white paper works well. Avoid sharp corners.",
      why: "A clear track is the test your robot has to pass.",
    },
    {
      id: "r4",
      title: "Mount the line sensors",
      minutes: 15,
      prereqs: ["r2"],
      actions: [
        "Fix the two sensors at the front, pointing down, 5 to 10 mm above the floor, about one tape width apart.",
      ],
      proof: [
        n("height", "Sensor height in mm (between 5 and 10)", 5, 10),
        c("down", "Both sensors point down"),
      ],
      hint: "Use a coin or a stack of paper as a spacer to set the height, then tighten the screws.",
      why: "The sensors only see the line properly at the right height and spacing.",
    },
    {
      id: "r5",
      title: "Wire the motor driver and battery",
      minutes: 20,
      prereqs: ["r2"],
      actions: [
        "Connect the motors to the driver and the driver to the board.",
        "Connect the battery lead last and leave it unplugged.",
      ],
      proof: [
        c("diagram", "Wiring matches the diagram"),
        c("unplugged", "Battery still unplugged"),
      ],
      hint: "Do one wire at a time and tick it off on the diagram as you go.",
      why: "The driver lets the small board control the motors without damaging it.",
    },
    {
      id: "r6",
      title: "Wire the sensors to the board",
      minutes: 15,
      prereqs: ["r4"],
      actions: ["Connect power, ground and signal from each sensor to the board."],
      proof: [c("wired", "Both sensors wired"), c("loose", "No loose wires")],
      hint: "Use one color for power, another for ground and a third for signal so you can check them at a glance.",
      why: "The board can only steer once it can read the sensors.",
    },
    {
      id: "r7",
      title: "Test motors and sensors separately",
      minutes: 20,
      prereqs: ["r5", "r6"],
      actions: [
        "Upload the test sketch and confirm each motor spins forward.",
        "Read the sensor values on white floor and on the tape.",
      ],
      proof: [
        pf("forward", "Both motors spin forward"),
        n("white", "Sensor value on white"),
        n("black", "Sensor value on black"),
        pf("differ", "Values differ clearly"),
      ],
      hint: "If a motor spins backward, swap its two wires on the driver.",
      why: "Testing parts one by one tells you exactly where a problem is.",
    },
    {
      id: "r8",
      title: "Upload line-following code and tune",
      minutes: 40,
      prereqs: ["r7", "r3"],
      actions: [
        "Upload the line-following sketch.",
        "Set the threshold halfway between your white and black values.",
        "Run it on the track.",
      ],
      proof: [n("threshold", "Threshold value"), pf("run", "One full run completed")],
      hint: "If it overshoots the curve, lower the motor speed in the code and try again.",
      why: "The threshold is how the robot tells the line from the floor.",
    },
  ],
  check: {
    kind: "passfail",
    items: [
      pf("run1", "Run 1 stayed on the line"),
      pf("run2", "Run 2 stayed on the line"),
      pf("run3", "Run 3 stayed on the line"),
    ],
  },
};

export const PLANS: Plan[] = [PHONE_PLAN, WEBSITE_PLAN, ROBOT_PLAN];

export const SUGGESTIONS = [
  {
    label: "Build an application",
    prompt:
      "Help me take an application idea from discovery through design, development, testing and launch. Start by understanding my idea and experience.",
  },
  {
    label: "Set up a new OS",
    prompt:
      "Help me set up a new operating system, from compatibility and backups through installation and verification. Ask about my device and target OS first.",
  },
  {
    label: "Plan and build a home",
    prompt:
      "Help me organize a home-building journey from needs and budget through design, professional work, inspections and handover. Start with my location and starting point.",
  },
  {
    label: "Make electronics",
    prompt:
      "Help me design, assemble and test an electronics project. Start by asking what it should do, my experience and available tools.",
  },
  {
    label: "Troubleshoot software",
    prompt:
      "Help me diagnose and fix a software problem, then verify the fix. Start by asking about symptoms, environment and recent changes.",
  },
  {
    label: "Learn something new",
    prompt:
      "Help me learn a subject through explanations, practice and demonstrated ability. Ask what I want to learn and my current level.",
  },
];
