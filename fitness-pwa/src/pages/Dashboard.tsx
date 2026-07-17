import { useEffect, useState } from 'react';
import { db } from '../database/db';
import type { UserProfile, WorkoutSession, FastingSession } from '../types';
import { calculateBMI, calculateBodyFatEstimate, formatDate, getToday } from '../utils/helpers';
import { 
  FireIcon, 
  TrendingDownIcon, 
  HeartIcon, 
  CheckCircleIcon,
  TrendingUpIcon,
} from '../components/Icons';

export default function Dashboard() {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [todayWorkout, setTodayWorkout] = useState<WorkoutSession | null>(null);
  const [recentWorkouts, setRecentWorkouts] = useState<WorkoutSession[]>([]);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [fastingToday, setFastingToday] = useState<FastingSession | null>(null);
  const [workoutStreak, setWorkoutStreak] = useState(0);
  const [bmi, setBmi] = useState<number | null>(null);
  const [bodyFat, setBodyFat] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Load user profile
      const profile = await db.userProfile.toCollection().first();
      if (profile) {
        setUserProfile(profile);
        
        // Calculate BMI
        const calculatedBmi = calculateBMI(profile.currentWeight, profile.height);
        setBmi(calculatedBmi);
        
        // Calculate body fat
        const bodyFatEst = calculateBodyFatEstimate(calculatedBmi, profile.age);
        setBodyFat(bodyFatEst);
      }

      // Load today's workout
      const today = getToday();
      const allSessions = await db.workoutSessions.orderBy('date').toArray();
      const todayWorkouts = allSessions.filter(
        w => new Date(w.date).toDateString() === today.toDateString()
      );
      
      if (todayWorkouts.length > 0) {
        setTodayWorkout(todayWorkouts[0]);
      }

      // Load recent workouts
      const allWorkouts = await db.workoutSessions
        .orderBy('date')
        .reverse()
        .limit(5)
        .toArray();
      setRecentWorkouts(allWorkouts);

      // Calculate workout streak
      const streak = await calculateWorkoutStreak();
      setWorkoutStreak(streak);

      // Load current weight
      const weights = await db.weightEntries
        .orderBy('date')
        .reverse()
        .limit(1)
        .toArray();
      if (weights.length > 0) {
        setCurrentWeight(weights[0].weight);
      }

      // Load today's fasting session
      const allFastingSessions = await db.fastingSessions.orderBy('date').toArray();
      const todayFastingSessions = allFastingSessions.filter(
        f => new Date(f.date).toDateString() === today.toDateString()
      );
      if (todayFastingSessions.length > 0) {
        setFastingToday(todayFastingSessions[0]);
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    }
  };

  const calculateWorkoutStreak = async (): Promise<number> => {
    const workouts = await db.workoutSessions
      .orderBy('date')
      .reverse()
      .toArray();

    if (workouts.length === 0) return 0;

    let streak = 0;
    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    for (const workout of workouts) {
      const workoutDate = new Date(workout.date);
      workoutDate.setHours(0, 0, 0, 0);

      if (workoutDate.getTime() === currentDate.getTime()) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else if (workoutDate.getTime() < currentDate.getTime()) {
        break;
      }
    }

    return streak;
  };

  const weightLost = userProfile && currentWeight ? userProfile.currentWeight - currentWeight : 0;
  const weightRemaining = userProfile && currentWeight ? currentWeight - userProfile.targetWeight : 0;
  const completedWorkouts = recentWorkouts.filter(w => w.completed).length;
  const completionRate = recentWorkouts.length > 0 
    ? Math.round((completedWorkouts / recentWorkouts.length) * 100) 
    : 0;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-2">
            Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            {formatDate(new Date())} • Track your progress
          </p>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Workout Streak */}
          <div className="card-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400">Streak</h3>
              <FireIcon className="w-5 h-5 text-orange-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              {workoutStreak}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {workoutStreak === 1 ? 'day' : 'days'} in a row
            </p>
          </div>

          {/* Weight Progress */}
          <div className="card-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                Weight Lost
              </h3>
              {weightLost > 0 ? (
                <TrendingDownIcon className="w-5 h-5 text-green-500" />
              ) : (
                <TrendingUpIcon className="w-5 h-5 text-red-500" />
              )}
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              {Math.abs(weightLost).toFixed(1)} kg
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {weightLost > 0 ? 'Great progress!' : 'Keep going!'}
            </p>
          </div>

          {/* Current Weight */}
          <div className="card-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                Current Weight
              </h3>
              <HeartIcon className="w-5 h-5 text-red-500" />
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              {currentWeight ? currentWeight.toFixed(1) : '--'} kg
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {userProfile ? `Goal: ${userProfile.targetWeight} kg` : 'No goal set'}
            </p>
          </div>

          {/* BMI */}
          <div className="card-lg">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400">BMI</h3>
              <div className="w-5 h-5 flex items-center justify-center text-sm font-bold text-blue-600 dark:text-blue-400">
                ✓
              </div>
            </div>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              {bmi ? bmi.toFixed(1) : '--'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {bodyFat ? `Body fat: ${Math.max(0, bodyFat).toFixed(1)}%` : 'N/A'}
            </p>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Workout & Fasting */}
          <div className="lg:col-span-2 space-y-6">
            {/* Today's Workout */}
            <div className="card-lg">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                    Today's Workout
                  </h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    {todayWorkout ? 'In progress' : 'Not started'}
                  </p>
                </div>
                {todayWorkout && todayWorkout.completed && (
                  <CheckCircleIcon className="w-8 h-8 text-green-500" />
                )}
              </div>

              {todayWorkout ? (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {todayWorkout.exercises.length} exercises
                  </p>
                  <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
                    <div className="space-y-2">
                      {todayWorkout.exercises.slice(0, 3).map((exercise, idx) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <span className="text-slate-700 dark:text-slate-300">
                            {exercise.exerciseName}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {exercise.sets.length}/{exercise.sets.length} sets
                          </span>
                        </div>
                      ))}
                      {todayWorkout.exercises.length > 3 && (
                        <p className="text-sm text-slate-500 dark:text-slate-400 pt-2">
                          +{todayWorkout.exercises.length - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    No workout planned for today
                  </p>
                  <a
                    href="/workout"
                    className="btn-primary inline-block"
                  >
                    Start Workout
                  </a>
                </div>
              )}
            </div>

            {/* Fasting Status */}
            <div className="card-lg">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
                Fasting Status
              </h2>

              {fastingToday ? (
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 rounded-lg p-6">
                    <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                      {fastingToday.type === 'omad' ? 'OMAD (One Meal A Day)' : '18:6 Fasting'}
                    </p>
                    <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                      {fastingToday.endTime ? (
                        <span>{fastingToday.hoursCompleted?.toFixed(1) || '0'} hrs</span>
                      ) : (
                        <span>In Progress</span>
                      )}
                    </p>
                  </div>
                  <a
                    href="/settings"
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    View Details →
                  </a>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400 mb-4">
                    Start your fasting session
                  </p>
                  <a
                    href="/settings"
                    className="btn-secondary btn-sm inline-block"
                  >
                    Start Fasting
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Quick Stats */}
          <div className="space-y-6">
            {/* Weight Goal */}
            <div className="card-lg">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
                Weight Goal
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-slate-600 dark:text-slate-400">Progress</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {userProfile && currentWeight ? Math.round((Math.abs(weightLost) / Math.abs(userProfile.currentWeight - userProfile.targetWeight)) * 100) : 0}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${userProfile && currentWeight ? Math.round((Math.abs(weightLost) / Math.abs(userProfile.currentWeight - userProfile.targetWeight)) * 100) : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                  <p>Current: {currentWeight?.toFixed(1) || '--'} kg</p>
                  <p>Target: {userProfile?.targetWeight} kg</p>
                  <p>Remaining: {weightRemaining.toFixed(1)} kg</p>
                </div>
              </div>
            </div>

            {/* Completion Rate */}
            <div className="card-lg">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
                This Week
              </h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      Completion
                    </span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {completionRate}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${completionRate}%` }}
                    ></div>
                  </div>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                  <p>Completed: {completedWorkouts}/{recentWorkouts.length}</p>
                  <p>Total Volume: N/A</p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="card-lg">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">
                Quick Actions
              </h3>
              <div className="space-y-2">
                <a
                  href="/workout"
                  className="w-full block text-center btn-primary btn-sm"
                >
                  Start Workout
                </a>
                <a
                  href="/weight"
                  className="w-full block text-center btn-secondary btn-sm"
                >
                  Log Weight
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
