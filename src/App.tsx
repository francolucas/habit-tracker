import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type FieldValue,
} from "firebase/firestore";
import {
  clearFirebaseConfig,
  initFirebase,
  isValidFirebaseConfig,
  loadFirebaseConfig,
  storeFirebaseConfig,
  type FirebaseConfig,
} from "./firebase";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const NEW_CATEGORY_VALUE = "__new__";

const SWATCHES = ["#f97316", "#0ea5a4", "#10b981", "#f43f5e", "#3b82f6"];

type HabitDef = {
  id: string;
  label?: string;
  active?: boolean;
  category?: string;
  type?: "boolean" | "enum" | "multiEnum" | "number";
  enumOptions?: string[];
  unit?: string;
  order?: number;
  color?: string;
};

type DayDoc = {
  v?: Record<string, boolean | string | number | string[]>;
  note?: string;
  date?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type DayWrite = Omit<DayDoc, "v"> & {
  v: Record<string, boolean | string | number | string[] | FieldValue>;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
};

const shiftDate = (date: Date, delta: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
};

const hashId = (value: string) =>
  value.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);

const getHabitColor = (habit: HabitDef) =>
  habit.color ?? SWATCHES[hashId(habit.id) % SWATCHES.length];

const toCamelCaseId = (value: string) => {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  const parts = normalized
    .trim()
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);

  if (!parts.length) {
    return "";
  }

  const [first, ...rest] = parts;
  return (
    first.toLowerCase() +
    rest
      .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
      .join("")
  );
};

const parseConfigInput = (raw: string): FirebaseConfig | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isValidFirebaseConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeLocaleNumberString = (raw: string) => {
  const compact = raw.trim().replace(/\s+/g, "");
  if (!compact) {
    return "";
  }

  const hasComma = compact.includes(",");
  const hasDot = compact.includes(".");
  if (!hasComma) {
    return compact;
  }

  if (!hasDot) {
    return compact.replace(/,/g, ".");
  }

  const decimalSep =
    compact.lastIndexOf(",") > compact.lastIndexOf(".") ? "," : ".";
  const thousandSep = decimalSep === "," ? "." : ",";
  const withoutThousands =
    thousandSep === "."
      ? compact.replace(/\./g, "")
      : compact.replace(/,/g, "");

  return decimalSep === ","
    ? withoutThousands.replace(/,/g, ".")
    : withoutThousands;
};

const parseLocaleNumber = (raw: string): number | null => {
  const normalized = normalizeLocaleNumberString(raw);
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function App() {
  const [config, setConfig] = useState<FirebaseConfig | null>(() =>
    loadFirebaseConfig()
  );
  const [configInput, setConfigInput] = useState("");
  const [configError, setConfigError] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [habits, setHabits] = useState<HabitDef[]>([]);
  const [dayEntries, setDayEntries] = useState<
    Record<string, boolean | string | number | string[]>
  >({});
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [habitsLoading, setHabitsLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(true);
  const [dayExists, setDayExists] = useState(false);
  const [dayNote, setDayNote] = useState("");
  const [savedDayNote, setSavedDayNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [newHabitName, setNewHabitName] = useState("");
  const [categorySelection, setCategorySelection] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [newHabitType, setNewHabitType] = useState("boolean");
  const [newHabitEnumOption, setNewHabitEnumOption] = useState("");
  const [newHabitEnumOptions, setNewHabitEnumOptions] = useState<string[]>([]);
  const [newHabitNumberUnit, setNewHabitNumberUnit] = useState("");
  const [newHabitActive, setNewHabitActive] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [firestoreError, setFirestoreError] = useState("");
  const [tokenStatus, setTokenStatus] = useState("");
  const [addHabitError, setAddHabitError] = useState("");
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null);
  const [showInactiveHabits, setShowInactiveHabits] = useState(false);

  const customCategoryRef = useRef<HTMLInputElement | null>(null);
  const enumOptionRef = useRef<HTMLInputElement | null>(null);
  const numberUnitRef = useRef<HTMLInputElement | null>(null);
  const habitFormRef = useRef<HTMLElement | null>(null);

  const firebase = useMemo(
    () => (config ? initFirebase(config) : null),
    [config]
  );
  const auth = firebase?.auth ?? null;
  const db = firebase?.db ?? null;

  const categories = useMemo(() => {
    const values = habits
      .map((habit) => habit.category?.trim())
      .filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0
      );

    const unique = Array.from(new Set(values));
    unique.sort((a, b) => a.localeCompare(b));

    return unique;
  }, [habits]);

  const activeHabits = useMemo(
    () => habits.filter((habit) => habit.active !== false),
    [habits]
  );

  const habitsForList = showInactiveHabits ? habits : activeHabits;

  const dateKey = formatDateKey(selectedDate);
  const prettyDate = DATE_FORMATTER.format(selectedDate);

  useEffect(() => {
    if (categorySelection !== NEW_CATEGORY_VALUE) {
      return;
    }

    requestAnimationFrame(() => {
      customCategoryRef.current?.focus();
    });
  }, [categorySelection]);

  useEffect(() => {
    if (newHabitType !== "enum" && newHabitType !== "multiEnum") {
      return;
    }

    requestAnimationFrame(() => {
      enumOptionRef.current?.focus();
    });
  }, [newHabitType]);

  useEffect(() => {
    if (newHabitType !== "number") {
      return;
    }

    requestAnimationFrame(() => {
      numberUnitRef.current?.focus();
    });
  }, [newHabitType]);

  useEffect(() => {
    if (!auth) {
      return;
    }

    setAuthLoading(true);
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setHabits([]);
      setDayEntries({});
      setDayNote("");
      setSavedDayNote("");
      setDayExists(false);
      setHabitsLoading(true);
      setDayLoading(true);
      setNoteError("");
      setFirestoreError("");
      setTokenStatus("");
      setUser(nextUser);
      setAuthLoading(false);
    });

    return () => unsub();
  }, [auth]);

  useEffect(() => {
    if (!user) {
      return;
    }

    user
      .getIdTokenResult()
      .then((result) => {
        setTokenStatus(
          `Token issued: ${result.issuedAtTime}. Expires: ${result.expirationTime}.`
        );
      })
      .catch((error) => {
        setTokenStatus(
          error instanceof Error ? error.message : "Token unavailable."
        );
      });
  }, [user]);

  useEffect(() => {
    if (!db || !user) {
      return;
    }

    setHabitsLoading(true);
    const unsub = onSnapshot(
      collection(db, "trackerDefs"),
      (snapshot) => {
        const next = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as Omit<HabitDef, "id">;
          return { id: docSnap.id, ...data };
        });

        next.sort((a, b) => {
          const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
          const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          return (a.label ?? "").localeCompare(b.label ?? "");
        });

        setHabits(next);
        setHabitsLoading(false);
        setFirestoreError("");
      },
      (error) => {
        setHabitsLoading(false);
        setFirestoreError(`trackerDefs: ${error.code} - ${error.message}`);
      }
    );

    return () => unsub();
  }, [db, user]);

  useEffect(() => {
    if (!db || !user) {
      return;
    }

    setDayLoading(true);
    setDayExists(false);
    setDayNote("");
    setSavedDayNote("");
    const dayRef = doc(db, "days", dateKey);
    const unsub = onSnapshot(
      dayRef,
      (snapshot) => {
        const data = snapshot.data() as DayDoc | undefined;
        setDayEntries(data?.v ?? {});
        const nextNote = data?.note ?? "";
        setDayNote(nextNote);
        setSavedDayNote(nextNote);
        setDayExists(snapshot.exists());
        setDayLoading(false);
        setFirestoreError("");
      },
      (error) => {
        setDayLoading(false);
        setFirestoreError(`days: ${error.code} - ${error.message}`);
      }
    );

    return () => unsub();
  }, [db, dateKey, user]);

  const setEnumHabitValue = async (habitId: string, nextValue: string) => {
    if (!db || !user) {
      return;
    }

    if (!dayExists && !nextValue) {
      return;
    }

    const dayRef = doc(db, "days", dateKey);
    const payload: DayWrite = {
      v: {
        [habitId]: nextValue || deleteField(),
      },
      date: dateKey,
      updatedAt: serverTimestamp(),
    };

    if (!dayExists) {
      payload.createdAt = serverTimestamp();
      payload.note = dayNote || "";
    }

    await setDoc(dayRef, payload, { merge: true });
    if (!dayExists) {
      setDayExists(true);
    }
  };

  const setMultiEnumHabitValues = async (
    habitId: string,
    nextValues: string[]
  ) => {
    if (!db || !user) {
      return;
    }

    const normalized = nextValues.map((value) => value.trim()).filter(Boolean);

    if (!dayExists && normalized.length === 0) {
      return;
    }

    const dayRef = doc(db, "days", dateKey);
    const payload: DayWrite = {
      v: {
        [habitId]: normalized.length ? normalized : deleteField(),
      },
      date: dateKey,
      updatedAt: serverTimestamp(),
    };

    if (!dayExists) {
      payload.createdAt = serverTimestamp();
      payload.note = dayNote || "";
    }

    await setDoc(dayRef, payload, { merge: true });
    if (!dayExists) {
      setDayExists(true);
    }
  };

  const setNumberHabitValue = async (
    habitId: string,
    nextValue: number | null
  ) => {
    if (!db || !user) {
      return;
    }

    if (!dayExists && nextValue === null) {
      return;
    }

    const dayRef = doc(db, "days", dateKey);
    const payload: DayWrite = {
      v: {
        [habitId]: nextValue === null ? deleteField() : nextValue,
      },
      date: dateKey,
      updatedAt: serverTimestamp(),
    };

    if (!dayExists) {
      payload.createdAt = serverTimestamp();
      payload.note = dayNote || "";
    }

    await setDoc(dayRef, payload, { merge: true });
    if (!dayExists) {
      setDayExists(true);
    }
  };

  const handleConfigSave = () => {
    const parsed = parseConfigInput(configInput);
    if (!parsed) {
      setConfigError(
        "Invalid config JSON. Paste the Firebase config object from the web SDK setup."
      );
      return;
    }
    storeFirebaseConfig(parsed);
    setConfig(parsed);
    setConfigInput("");
    setConfigError("");
  };

  const handleConfigClear = async () => {
    if (auth) {
      await signOut(auth);
    }
    clearFirebaseConfig();
    setConfig(null);
    setConfigInput("");
    setConfigError("");
    setAuthError("");
    setFirestoreError("");
    setTokenStatus("");
  };

  const toggleHabit = async (habitId: string) => {
    if (!db || !user) {
      return;
    }
    const dayRef = doc(db, "days", dateKey);
    const current = dayEntries[habitId] === true;
    const payload: DayWrite = {
      v: {
        [habitId]: !current,
      },
      date: dateKey,
      updatedAt: serverTimestamp(),
    };
    if (!dayExists) {
      payload.createdAt = serverTimestamp();
      payload.note = dayNote || "";
    }
    await setDoc(dayRef, payload, { merge: true });
    if (!dayExists) {
      setDayExists(true);
    }
  };

  const handleAddHabit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !user) {
      return;
    }
    const name = newHabitName.trim();
    if (!name) {
      setAddHabitError("Please enter a habit name.");
      return;
    }

    const category =
      categorySelection === NEW_CATEGORY_VALUE
        ? customCategory.trim()
        : categorySelection.trim();

    if (!categorySelection) {
      setAddHabitError("Please select a category.");
      return;
    }

    if (categorySelection === NEW_CATEGORY_VALUE && !category) {
      setAddHabitError("Please enter a new category.");
      return;
    }

    if (
      (newHabitType === "enum" || newHabitType === "multiEnum") &&
      newHabitEnumOptions.length === 0
    ) {
      setAddHabitError("Please add at least one enum option.");
      return;
    }

    const unit = newHabitNumberUnit.trim();
    if (newHabitType === "number" && !unit) {
      setAddHabitError("Please enter a unit for number habits.");
      return;
    }

    setAddHabitError("");

    const resetHabitForm = () => {
      setNewHabitName("");
      setCategorySelection("");
      setCustomCategory("");
      setNewHabitType("boolean");
      setNewHabitEnumOption("");
      setNewHabitEnumOptions([]);
      setNewHabitNumberUnit("");
      setNewHabitActive(true);
      setEditingHabitId(null);
    };

    try {
      if (editingHabitId) {
        const docRef = doc(db, "trackerDefs", editingHabitId);
        await setDoc(
          docRef,
          {
            label: name,
            active: newHabitActive,
            category,
            updatedAt: serverTimestamp(),
            ...(newHabitType === "enum" || newHabitType === "multiEnum"
              ? { enumOptions: newHabitEnumOptions }
              : { enumOptions: deleteField() }),
            ...(newHabitType === "number" ? { unit } : { unit: deleteField() }),
          },
          { merge: true }
        );
        resetHabitForm();
        return;
      }

      const docId = toCamelCaseId(name);
      if (!docId) {
        setAddHabitError("Could not generate a valid habit ID.");
        return;
      }
      const docRef = doc(db, "trackerDefs", docId);
      const existing = await getDoc(docRef);
      if (existing.exists()) {
        setAddHabitError(`A habit with ID "${docId}" already exists.`);
        return;
      }

      const nextOrder =
        habits.reduce((max, habit) => Math.max(max, habit.order ?? 0), 0) + 10;
      await setDoc(docRef, {
        label: name,
        active: newHabitActive,
        category,
        type: newHabitType,
        ...(newHabitType === "enum" || newHabitType === "multiEnum"
          ? { enumOptions: newHabitEnumOptions }
          : {}),
        ...(newHabitType === "number" ? { unit } : {}),
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      resetHabitForm();
    } catch (error) {
      setAddHabitError(
        error instanceof Error
          ? error.message
          : editingHabitId
          ? "Failed to update habit."
          : "Failed to add habit."
      );
    }
  };

  const addEnumOption = () => {
    const next = newHabitEnumOption.trim();
    if (!next) {
      return;
    }
    setNewHabitEnumOptions((current) =>
      current.includes(next) ? current : [...current, next]
    );
    setNewHabitEnumOption("");

    requestAnimationFrame(() => {
      enumOptionRef.current?.focus();
    });
  };

  const removeEnumOption = (value: string) => {
    setNewHabitEnumOptions((current) =>
      current.filter((item) => item !== value)
    );
  };

  const startEditingHabit = (habit: HabitDef) => {
    setEditingHabitId(habit.id);
    setAddHabitError("");
    setNewHabitName(habit.label ?? habit.id);
    setNewHabitActive(habit.active !== false);
    setNewHabitType(habit.type ?? "boolean");
    setNewHabitEnumOption("");
    setNewHabitEnumOptions(habit.enumOptions ?? []);
    setNewHabitNumberUnit(habit.unit ?? "");

    const category = habit.category?.trim() ?? "";
    setCategorySelection(category);
    setCustomCategory("");

    requestAnimationFrame(() => {
      habitFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const cancelEditingHabit = () => {
    setEditingHabitId(null);
    setAddHabitError("");
    setNewHabitName("");
    setCategorySelection("");
    setCustomCategory("");
    setNewHabitType("boolean");
    setNewHabitEnumOption("");
    setNewHabitEnumOptions([]);
    setNewHabitNumberUnit("");
    setNewHabitActive(true);
  };

  const handleSaveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!db || !user) {
      return;
    }
    setNoteError("");
    setNoteSaving(true);
    const dayRef = doc(db, "days", dateKey);
    const payload: DayDoc = {
      note: dayNote,
      date: dateKey,
      updatedAt: serverTimestamp(),
    };
    if (!dayExists) {
      payload.createdAt = serverTimestamp();
    }
    try {
      await setDoc(dayRef, payload, { merge: true });
      setDayExists(true);
      setSavedDayNote(dayNote);
    } catch (error) {
      setNoteError(
        error instanceof Error ? error.message : "Failed to save note."
      );
    } finally {
      setNoteSaving(false);
    }
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!auth) {
      return;
    }
    setAuthError("");
    try {
      await signInWithEmailAndPassword(auth, authEmail.trim(), authPassword);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in failed.");
    }
  };

  const handleCreateAccount = async () => {
    if (!auth) {
      return;
    }
    setAuthError("");
    try {
      await createUserWithEmailAndPassword(
        auth,
        authEmail.trim(),
        authPassword
      );
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Account creation failed."
      );
    }
  };

  const handleSignOut = async () => {
    if (!auth) {
      return;
    }
    await signOut(auth);
  };

  const completedCount = activeHabits.reduce((total, habit) => {
    const entry = dayEntries[habit.id];
    if (habit.type === "enum") {
      return total + (typeof entry === "string" && entry.length > 0 ? 1 : 0);
    }

    if (habit.type === "multiEnum") {
      return total + (Array.isArray(entry) && entry.length > 0 ? 1 : 0);
    }

    if (habit.type === "number") {
      return (
        total + (typeof entry === "number" && Number.isFinite(entry) ? 1 : 0)
      );
    }

    return total + (entry === true ? 1 : 0);
  }, 0);

  const completionRate = activeHabits.length
    ? Math.round((completedCount / activeHabits.length) * 100)
    : 0;

  if (!config) {
    return (
      <div className="app">
        <header className="hero setup setup-connect">
          <div className="setup-title">
            <span className="eyebrow">Private setup</span>
            <h1>Connect your Firebase</h1>
          </div>
          <p className="lead setup-lead">
            Paste your Firebase web config JSON. It stays in this browser and is
            used to reach your Firestore collections.
          </p>
          <div className="setup-form">
            <textarea
              value={configInput}
              onChange={(event) => setConfigInput(event.target.value)}
              rows={8}
              placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}'
            />
            {configError ? <p className="error">{configError}</p> : null}
            <div className="actions">
              <button className="primary" onClick={handleConfigSave}>
                Save config
              </button>
              <button className="ghost" onClick={() => setConfigInput("")}>
                Clear
              </button>
            </div>
          </div>
          <p className="meta setup-meta">
            Optional: set `VITE_FIREBASE_CONFIG` in a local `.env` file instead
            of pasting each time.
          </p>
        </header>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="app">
        <header className="hero setup">
          <span className="eyebrow">Checking session</span>
          <h1>Hang tight</h1>
          <p className="lead">Confirming your authentication state…</p>
        </header>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <header className="hero setup">
          <span className="eyebrow">Sign in required</span>
          <h1>Secure your tracker</h1>
          <p className="lead">
            Sign in with Firebase Authentication to access your habits. Enable
            Email/Password in the Firebase console first.
          </p>
          <form className="form" onSubmit={handleSignIn}>
            <input
              type="email"
              autoComplete="email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="you@email.com"
              aria-label="Email"
            />
            <input
              type="password"
              autoComplete="current-password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Password"
              aria-label="Password"
            />
            {authError ? <p className="error">{authError}</p> : null}
            <div className="actions">
              <button className="primary" type="submit">
                Sign in
              </button>
              <button
                className="ghost"
                type="button"
                onClick={handleCreateAccount}
              >
                Create account
              </button>
            </div>
          </form>
          <div className="actions">
            <button className="ghost" onClick={handleConfigClear}>
              Reset Firebase config
            </button>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="hero">
        <div>
          <span className="eyebrow">Daily focus</span>
          <h1>Habit Tracker</h1>
          <p className="date">{prettyDate}</p>
        </div>
        <div className="hero-actions">
          <div className="progress">
            <span className="progress-label">{completionRate}%</span>
            <span className="progress-sub">
              {completedCount} of {activeHabits.length} done
            </span>
          </div>
          <div className="controls">
            <button
              onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
            >
              {SHORT_DATE.format(shiftDate(selectedDate, -1))}
            </button>
            <button
              className="ghost"
              onClick={() => setSelectedDate(new Date())}
            >
              Today
            </button>
            <button onClick={() => setSelectedDate(shiftDate(selectedDate, 1))}>
              {SHORT_DATE.format(shiftDate(selectedDate, 1))}
            </button>
          </div>
        </div>
      </header>

      <div className="grid">
        <section className="card">
          <div className="section-head">
            <h2>Habits</h2>
            <div className="section-tools">
              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={showInactiveHabits}
                  onChange={(event) =>
                    setShowInactiveHabits(event.target.checked)
                  }
                />
                <span>Show inactive</span>
              </label>
              <span className="pill">{dateKey}</span>
            </div>
          </div>
          {habitsLoading || dayLoading ? (
            <p className="meta">Loading your habits…</p>
          ) : habitsForList.length === 0 ? (
            <p className="meta">
              No habits yet. Add documents in `trackerDefs` or create one below.
            </p>
          ) : (
            <ul className="habit-list">
              {habitsForList.map((habit, index) => {
                const entry = dayEntries[habit.id];
                const isEnum = habit.type === "enum";
                const isMultiEnum = habit.type === "multiEnum";
                const isNumber = habit.type === "number";
                const done = isEnum
                  ? typeof entry === "string" && entry.length > 0
                  : isMultiEnum
                  ? Array.isArray(entry) && entry.length > 0
                  : isNumber
                  ? typeof entry === "number" && Number.isFinite(entry)
                  : entry === true;
                const inactive = habit.active === false;
                const multiValues =
                  isMultiEnum && Array.isArray(entry) ? entry : [];
                const details = [habit.category, habit.type]
                  .filter(Boolean)
                  .join(" · ");
                const status = inactive
                  ? "Inactive"
                  : isEnum
                  ? typeof entry === "string" && entry.length > 0
                    ? entry
                    : "Not tracked"
                  : isMultiEnum
                  ? multiValues.length
                    ? multiValues.join(", ")
                    : "Not tracked"
                  : isNumber
                  ? typeof entry === "number" && Number.isFinite(entry)
                    ? `${entry}${habit.unit ? ` ${habit.unit}` : ""}`
                    : "Not tracked"
                  : done
                  ? "Completed"
                  : "Not yet";
                return (
                  <li
                    key={habit.id}
                    className={`habit-item ${done ? "done" : ""} ${
                      inactive ? "inactive" : ""
                    }`}
                    style={{ animationDelay: `${index * 45}ms` }}
                  >
                    {isEnum ? (
                      <select
                        className="enum-select"
                        value={typeof entry === "string" ? entry : ""}
                        onChange={(event) =>
                          void setEnumHabitValue(habit.id, event.target.value)
                        }
                        aria-label={`${habit.label ?? habit.id} value`}
                        disabled={inactive}
                      >
                        <option value="">Not tracked</option>
                        {(habit.enumOptions ?? []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : isMultiEnum ? (
                      <div className="multi-enum">
                        {(habit.enumOptions ?? []).map((option) => {
                          const checked = multiValues.includes(option);
                          return (
                            <label key={option} className="multi-enum-option">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const next = event.target.checked
                                    ? [...multiValues, option]
                                    : multiValues.filter(
                                        (value) => value !== option
                                      );
                                  void setMultiEnumHabitValues(habit.id, next);
                                }}
                                aria-label={`${
                                  habit.label ?? habit.id
                                } ${option}`}
                                disabled={inactive}
                              />
                              <span>{option}</span>
                            </label>
                          );
                        })}
                      </div>
                    ) : isNumber ? (
                      <input
                        className="number-input"
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*[.,]?[0-9]*"
                        value={
                          numberDrafts[habit.id] ??
                          (typeof entry === "number" && Number.isFinite(entry)
                            ? String(entry)
                            : "")
                        }
                        onChange={(event) => {
                          const raw = event.target.value;
                          setNumberDrafts((prev) => ({
                            ...prev,
                            [habit.id]: raw,
                          }));
                          if (!raw) {
                            void setNumberHabitValue(habit.id, null);
                            return;
                          }
                          const parsed = parseLocaleNumber(raw);
                          if (parsed === null) {
                            return;
                          }
                          void setNumberHabitValue(habit.id, parsed);
                        }}
                        onBlur={() => {
                          const raw = numberDrafts[habit.id];
                          if (raw === undefined) {
                            return;
                          }

                          if (!raw.trim()) {
                            void setNumberHabitValue(habit.id, null);
                            setNumberDrafts((prev) => {
                              const next = { ...prev };
                              delete next[habit.id];
                              return next;
                            });
                            return;
                          }

                          const parsed = parseLocaleNumber(raw);
                          if (parsed !== null) {
                            void setNumberHabitValue(habit.id, parsed);
                          }

                          setNumberDrafts((prev) => {
                            const next = { ...prev };
                            delete next[habit.id];
                            return next;
                          });
                        }}
                        placeholder={habit.unit ? habit.unit : "Not tracked"}
                        aria-label={`${habit.label ?? habit.id} value`}
                        disabled={inactive}
                      />
                    ) : (
                      <button
                        className="toggle"
                        onClick={() => void toggleHabit(habit.id)}
                        aria-pressed={done}
                        disabled={inactive}
                      >
                        <span className="toggle-dot" />
                      </button>
                    )}
                    <div className="habit-body">
                      <p className="habit-name">{habit.label ?? habit.id}</p>
                      <p className="habit-meta">
                        {status}
                        {details ? ` · ${details}` : ""}
                      </p>
                    </div>
                    <div className="habit-right">
                      <button
                        type="button"
                        className="ghost mini"
                        onClick={() => startEditingHabit(habit)}
                        disabled={habitsLoading || dayLoading}
                      >
                        Edit
                      </button>
                      <span
                        className="habit-color"
                        style={{ background: getHabitColor(habit) }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="stack">
          <section className="card">
            <div className="section-head">
              <h2>Daily note</h2>
              <span className="pill accent">Optional</span>
            </div>
            <form className="form" onSubmit={handleSaveNote}>
              <textarea
                value={dayNote}
                onChange={(event) => setDayNote(event.target.value)}
                rows={4}
                placeholder="What made today feel different?"
                aria-label="Daily note"
              />
              <button
                className="primary"
                type="submit"
                disabled={
                  noteSaving ||
                  dayLoading ||
                  dayNote.trim() === savedDayNote.trim()
                }
              >
                {noteSaving ? "Saving…" : "Save note"}
              </button>
            </form>
            {noteError ? <p className="error">{noteError}</p> : null}
          </section>

          <section className="card" ref={habitFormRef}>
            <div className="section-head">
              <h2>{editingHabitId ? "Edit habit" : "Add habit"}</h2>
              {editingHabitId ? (
                <span className="pill">{editingHabitId}</span>
              ) : (
                <span className="pill accent">Quick create</span>
              )}
            </div>
            <form className="form" onSubmit={handleAddHabit}>
              <input
                value={newHabitName}
                onChange={(event) => setNewHabitName(event.target.value)}
                placeholder="e.g. Stretch for 5 minutes"
                aria-label="New habit"
              />
              <label className="inline">
                <span>Category</span>
                <select
                  value={categorySelection}
                  onChange={(event) => setCategorySelection(event.target.value)}
                  aria-label="Habit category"
                  required
                >
                  <option value="" disabled>
                    Select a category…
                  </option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                  <option value={NEW_CATEGORY_VALUE}>New…</option>
                </select>
              </label>
              {categorySelection === NEW_CATEGORY_VALUE ? (
                <input
                  ref={customCategoryRef}
                  value={customCategory}
                  onChange={(event) => setCustomCategory(event.target.value)}
                  placeholder="New category"
                  aria-label="New category"
                  required
                />
              ) : null}
              <label className="inline">
                <span>Type</span>
                <select
                  value={newHabitType}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    setNewHabitType(nextType);
                    if (nextType !== "enum" && nextType !== "multiEnum") {
                      setNewHabitEnumOption("");
                      setNewHabitEnumOptions([]);
                    }
                    if (nextType !== "number") {
                      setNewHabitNumberUnit("");
                    }
                  }}
                  aria-label="Habit type"
                  disabled={Boolean(editingHabitId)}
                >
                  <option value="boolean">Boolean</option>
                  <option value="enum">Enum</option>
                  <option value="multiEnum">Multi enum</option>
                  <option value="number">Number</option>
                </select>
              </label>
              {newHabitType === "enum" || newHabitType === "multiEnum" ? (
                <div className="enum-builder">
                  <input
                    ref={enumOptionRef}
                    value={newHabitEnumOption}
                    onChange={(event) =>
                      setNewHabitEnumOption(event.target.value)
                    }
                    placeholder="Add enum option"
                    aria-label="Enum option"
                  />
                  <button
                    type="button"
                    onClick={addEnumOption}
                    disabled={!newHabitEnumOption.trim()}
                  >
                    Add option
                  </button>
                </div>
              ) : null}
              {newHabitType === "number" ? (
                <label className="inline">
                  <span>Unit</span>
                  <input
                    ref={numberUnitRef}
                    value={newHabitNumberUnit}
                    onChange={(event) =>
                      setNewHabitNumberUnit(event.target.value)
                    }
                    placeholder="e.g. kg, minutes, cups"
                    aria-label="Number unit"
                    required
                  />
                </label>
              ) : null}
              {newHabitType === "enum" || newHabitType === "multiEnum" ? (
                newHabitEnumOptions.length ? (
                  <ul className="enum-options">
                    {newHabitEnumOptions.map((option) => (
                      <li key={option} className="enum-option-row">
                        <span>{option}</span>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => removeEnumOption(option)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="meta">Add at least one enum option.</p>
                )
              ) : null}
              <label className="inline">
                <span>Active</span>
                <input
                  type="checkbox"
                  checked={newHabitActive}
                  onChange={(event) => setNewHabitActive(event.target.checked)}
                />
              </label>
              <div className="actions">
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    !newHabitName.trim() ||
                    !categorySelection ||
                    (categorySelection === NEW_CATEGORY_VALUE &&
                      !customCategory.trim()) ||
                    ((newHabitType === "enum" ||
                      newHabitType === "multiEnum") &&
                      newHabitEnumOptions.length === 0) ||
                    (newHabitType === "number" && !newHabitNumberUnit.trim())
                  }
                >
                  {editingHabitId ? "Save changes" : "Add"}
                </button>
                {editingHabitId ? (
                  <button
                    className="ghost"
                    type="button"
                    onClick={cancelEditingHabit}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
            {addHabitError ? <p className="error">{addHabitError}</p> : null}
            <p className="meta">
              Habits live in `trackerDefs`. They are shared across all dates.
            </p>
          </section>

          <section className="card">
            <div className="section-head">
              <h2>Local config</h2>
              <span className="pill">{config.projectId}</span>
            </div>
            <p className="meta">
              Signed in as {user.email ?? "unknown"}.
              <br />
              UID: {user.uid}
              <br />
              Firebase config stays in this browser.
            </p>
            {tokenStatus ? <p className="meta">{tokenStatus}</p> : null}
            {firestoreError ? <p className="error">{firestoreError}</p> : null}
            <div className="actions">
              <button className="ghost" onClick={handleSignOut}>
                Sign out
              </button>
              <button className="ghost" onClick={handleConfigClear}>
                Reset config
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
