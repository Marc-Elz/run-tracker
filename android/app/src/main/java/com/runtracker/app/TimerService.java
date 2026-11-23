package com.runtracker.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the app's process in the foreground while the exercise timer runs (#124). Without it,
 * Samsung's freezer stops the process about 90 seconds after the screen is locked, and the
 * timer's cues (timed in the page's JavaScript) never come. During a run the GPS service does
 * the same job; this one does no work of its own, it only shows the notification.
 */
public class TimerService extends Service {

    private static final String CHANNEL_ID = "timer";
    private static final int NOTIFICATION_ID = 124;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(
            new NotificationChannel(CHANNEL_ID, "Exercise timer", NotificationManager.IMPORTANCE_LOW)
        );

        // Tapping the notification brings the app back to the timer screen
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE);

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Exercise timer running")
            .setContentText("Cues continue with the screen locked")
            .setSmallIcon(getApplicationInfo().icon)
            .setContentIntent(tap)
            .setOngoing(true)
            .setSilent(true)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        // If Android kills the app anyway, the timer in the page is gone, so don't restart
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
