package com.runtracker.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.View;
import android.webkit.WebView;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayDeque;
import java.util.Locale;

/**
 * What a run needs from Android beyond location: the battery optimisation exemption (so the
 * system doesn't kill the app mid-run), the notification permission for the foreground
 * service notification (Android 13+), audio focus for spoken cues, and the phone's motion
 * level for auto-pause (#154).
 */
@CapacitorPlugin(
    name = "RunPower",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class RunPowerPlugin extends Plugin {

    private static final String TAG = "RunPower";
    /** The motion level is the spread of the last this-many ms of acceleration */
    private static final long MOTION_WINDOW_MS = 2000;
    /** How often the motion level is sent */
    private static final long MOTION_EVERY_MS = 1000;
    /** Fewer samples than this in the window is no level (the sensor stalled) */
    private static final int MOTION_MIN_SAMPLES = 10;

    private AudioFocusRequest focusRequest;
    private boolean keepWebViewAlive = false;

    private final Handler motionHandler = new Handler(Looper.getMainLooper());
    private boolean motionOn = false;
    /**
     * Acceleration samples of the last `MOTION_WINDOW_MS`, oldest first: {arrival time in ms since
     * boot, magnitude in m/s²}. Kept as samples (not a running sum) so cadence can later be found
     * in the same data (#171). Only touched on the main thread: the listener is registered there.
     */
    private final ArrayDeque<double[]> motionSamples = new ArrayDeque<>();

    private final SensorEventListener motionListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            float x = event.values[0];
            float y = event.values[1];
            float z = event.values[2];
            long now = SystemClock.elapsedRealtime();
            motionSamples.addLast(new double[] { now, Math.sqrt(x * x + y * y + z * z) });
            pruneMotion(now);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    private final Runnable emitMotion = new Runnable() {
        @Override
        public void run() {
            if (!motionOn) return;
            pruneMotion(SystemClock.elapsedRealtime());
            int count = motionSamples.size();
            JSObject ret = new JSObject();
            ret.put("at", System.currentTimeMillis());
            ret.put("samples", count);
            if (count >= MOTION_MIN_SAMPLES) {
                double level = motionSpread();
                ret.put("level", level);
                Log.i(TAG, String.format(Locale.ROOT, "[motion] level=%.2f samples=%d", level, count));
            } else {
                Log.i(TAG, "[motion] no level, samples=" + count);
            }
            notifyListeners("motion", ret);
            motionHandler.postDelayed(this, MOTION_EVERY_MS);
        }
    };

    /**
     * Auto-pause (#154): starts measuring the phone's motion. Once a second a `motion` event
     * carries `level`, the standard deviation of the acceleration magnitude over the last 2 s in
     * m/s² (gravity cancels out), and `samples`, how many readings it is based on. No level when
     * the sensor delivered too few. Only measures: auto-pause decides in JavaScript. No permission
     * needed. Resolves with `available: false` on a phone without an accelerometer.
     */
    @PluginMethod
    public void startMotion(PluginCall call) {
        JSObject ret = new JSObject();
        if (!motionOn) {
            SensorManager sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            Sensor accelerometer = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (accelerometer == null) {
                ret.put("available", false);
                call.resolve(ret);
                return;
            }
            sensors.registerListener(motionListener, accelerometer, SensorManager.SENSOR_DELAY_GAME, motionHandler);
            motionOn = true;
            motionHandler.postDelayed(emitMotion, MOTION_EVERY_MS);
            Log.i(TAG, "[motion] started");
        }
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopMotion(PluginCall call) {
        endMotion();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        endMotion();
        super.handleOnDestroy();
    }

    private void endMotion() {
        if (!motionOn) return;
        motionOn = false;
        SensorManager sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensors != null) sensors.unregisterListener(motionListener);
        motionHandler.removeCallbacks(emitMotion);
        motionSamples.clear();
        Log.i(TAG, "[motion] stopped");
    }

    private void pruneMotion(long now) {
        while (!motionSamples.isEmpty() && motionSamples.peekFirst()[0] < now - MOTION_WINDOW_MS) {
            motionSamples.pollFirst();
        }
    }

    /** Standard deviation of the magnitudes in the window */
    private double motionSpread() {
        double sum = 0;
        double sumSq = 0;
        for (double[] sample : motionSamples) {
            sum += sample[1];
            sumSq += sample[1] * sample[1];
        }
        int n = motionSamples.size();
        double mean = sum / n;
        return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
    }

    /**
     * While a run is on, keeps the WebView running with the screen off. Android otherwise freezes
     * the page's JavaScript about a minute after the screen goes off, which stalls the run timer,
     * GPS fix handling and the spoken cues. The same workaround cordova-plugin-background-mode uses.
     */
    @PluginMethod
    public void setKeepWebViewAlive(PluginCall call) {
        keepWebViewAlive = Boolean.TRUE.equals(call.getBoolean("keep", false));
        if (keepWebViewAlive) keepAlive();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (keepWebViewAlive) keepAlive();
    }

    @Override
    protected void handleOnStop() {
        super.handleOnStop();
        if (keepWebViewAlive) keepAlive();
    }

    /** Runs after the activity has paused, so the system's own pause doesn't win. */
    private void keepAlive() {
        new Handler(Looper.getMainLooper()).postDelayed(
            () -> {
                if (!keepWebViewAlive) return;
                WebView webView = getBridge().getWebView();
                webView.onResume();
                webView.resumeTimers();
                webView.dispatchWindowVisibilityChanged(View.VISIBLE);
            },
            500
        );
    }

    /** Asks other apps (music) to lower their volume while a spoken cue plays. */
    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        // AudioFocusRequest needs API 26; on older phones the cue is spoken without ducking
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .build();
        audio.requestAudioFocus(focusRequest);
        call.resolve();
    }

    /** Lets other apps return to full volume. */
    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        if (focusRequest != null) {
            AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            audio.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        }
        call.resolve();
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        call.resolve(batteryResult());
    }

    /** Shows the system "Allow" dialog; resolves once it has closed. */
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (isIgnoring()) {
            call.resolve(batteryResult());
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        startActivityForResult(call, intent, "batteryDialogClosed");
    }

    /** Opens the system battery optimisation list, where the exemption can be removed again. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @ActivityCallback
    private void batteryDialogClosed(PluginCall call, ActivityResult result) {
        call.resolve(batteryResult());
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsGranted()) {
            call.resolve(notificationResult());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsAnswered");
    }

    @PermissionCallback
    private void notificationsAnswered(PluginCall call) {
        call.resolve(notificationResult());
    }

    private boolean isIgnoring() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private boolean notificationsGranted() {
        return getPermissionState("notifications") == PermissionState.GRANTED;
    }

    private JSObject batteryResult() {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoring());
        return ret;
    }

    private JSObject notificationResult() {
        JSObject ret = new JSObject();
        ret.put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || notificationsGranted());
        return ret;
    }
}
