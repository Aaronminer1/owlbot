package dev.owlbot.brain;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.SearchManager;
import android.content.Context;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.content.Intent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.Html;
import android.util.Base64;
import android.util.Log;
import android.util.Xml;
import android.view.View;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.app.Activity;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.StringReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.face.Face;
import com.google.mlkit.vision.face.FaceDetection;
import com.google.mlkit.vision.face.FaceDetector;
import com.google.mlkit.vision.face.FaceDetectorOptions;
import com.google.mlkit.vision.face.FaceLandmark;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

/**
 * OwlBot Brain - a WebView host for the phone-brain page.
 *
 * Why a WebView and not a hosted PWA: the brain talks to the robot body over a
 * plain ws:// socket on the LAN, and a page served over https can never open
 * one (mixed content). Loading from file:///android_asset sidesteps that
 * entirely, and it also means the app works with no internet at all - which is
 * the point of the direct transport.
 *
 * The Java side exists to supply the four things a WebView cannot do itself:
 *   - runtime camera/mic permission, and the WebView-level grant that follows it
 *   - text to speech (Android WebView has no Web Speech synthesis)
 *   - speech recognition (likewise)
 *   - keeping the screen on and the phone awake while the creature is running
 *
 * Everything else stays in the page, so the same file runs unchanged in a
 * desktop browser.
 */
public class MainActivity extends Activity implements SensorEventListener, LocationListener {

    private static final String TAG = "OwlBot";
    private static final String PAGE = "file:///android_asset/growbot-brain.html";
    private static final int REQ_PERMS = 4711;
    private static final String SECRET_ALIAS = "owlbot-secrets-v1";
    private static final String SECRET_PREFS = "owlbot_secure";
    private static final String PERMISSION_PREFS = "owlbot_permissions";

    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private SpeechRecognizer recognizer;
    private boolean micPaused = false;    // user pause, or we are talking
    private boolean listening = false;    // a recognition session is live
    private long lastRms = 0;
    private long sessionStart = 0;
    private final Handler main = new Handler(Looper.getMainLooper());
    private SensorManager sensorManager;
    private LocationManager locationManager;
    private final Object sensorLock = new Object();
    private final Set<String> activeSensors = new LinkedHashSet<>();
    private final float[] nativeAccel = {Float.NaN, Float.NaN, Float.NaN};
    private final float[] nativeGyro = {Float.NaN, Float.NaN, Float.NaN};
    private final float[] nativeMagnetic = {Float.NaN, Float.NaN, Float.NaN};
    private final float[] nativeGravity = {Float.NaN, Float.NaN, Float.NaN};
    private final float[] nativeLinearAccel = {Float.NaN, Float.NaN, Float.NaN};
    private final float[] nativeOrientation = {Float.NaN, Float.NaN, Float.NaN};
    private float nativeLight = Float.NaN;
    private float nativePressure = Float.NaN;
    private float nativeProximity = Float.NaN;
    private float nativeAmbientTemp = Float.NaN;
    private float nativeHumidity = Float.NaN;
    private float nativeSteps = Float.NaN;
    private long nativeSensorAt = 0;
    private volatile Location lastLocation;
    private boolean locationUpdates = false;
    private boolean hardwareSensorsPaused = false;
    private boolean sensorLowPower = false;

    // A WebView permission request can arrive before the OS has granted us the
    // underlying permission, so we park it until the user has answered.
    private PermissionRequest pendingWebRequest;
    private boolean pendingSpeechListen = false;

    private String checkedSecretName(String name) {
        if ("mind_api".equals(name) || "voice_api".equals(name)
                || "body_control".equals(name)) return name;
        return null;
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(SECRET_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(SECRET_ALIAS, null))
                    .getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                SECRET_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private synchronized boolean saveSecretValue(String name, String value) {
        String key = checkedSecretName(name);
        if (key == null) return false;
        SharedPreferences prefs = getSharedPreferences(SECRET_PREFS, MODE_PRIVATE);
        if (value == null || value.isEmpty()) {
            prefs.edit().remove(key).apply();
            return true;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            String packed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)
                    + "." + Base64.encodeToString(ciphertext, Base64.NO_WRAP);
            prefs.edit().putString(key, packed).apply();
            return true;
        } catch (Exception e) {
            Log.w(TAG, "secure secret save failed for " + key + ": "
                    + e.getClass().getSimpleName());
            return false;
        }
    }

    private synchronized String loadSecretValue(String name) {
        String key = checkedSecretName(name);
        if (key == null) return "";
        try {
            String packed = getSharedPreferences(SECRET_PREFS, MODE_PRIVATE)
                    .getString(key, "");
            if (packed == null || packed.isEmpty()) return "";
            String[] parts = packed.split("\\.", 2);
            if (parts.length != 2) return "";
            byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
            byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, "secure secret load failed for " + key + ": "
                    + e.getClass().getSimpleName());
            return "";
        }
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);

        web = new WebView(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // The animated face, camera and audio all share this renderer.
            // Keep Android from treating it as disposable while OwlBot is the
            // visible foreground app.
            web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        setContentView(web);
        goImmersive();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // Autoplay of the camera/mic streams must not need a tap.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(false);
        // The page lives on file://; it needs to reach http:// and ws:// hosts.
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUseWideViewPort(false);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }

        WebView.setWebContentsDebuggingEnabled(
                (getApplicationInfo().flags
                        & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        web.setWebViewClient(new WebViewClient() {
            private boolean allowed(String url) {
                return PAGE.equals(url);
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                boolean block = !allowed(req.getUrl().toString());
                if (block) Log.w(TAG, "blocked navigation to " + req.getUrl());
                return block;
            }
            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                boolean block = !allowed(url);
                if (block) Log.w(TAG, "blocked navigation to " + url);
                return block;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                main.post(() -> handleWebPermission(request));
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                // Makes `adb logcat -s OwlBot` a usable debug channel.
                Log.i(TAG, m.messageLevel() + " " + m.message()
                        + " (line " + m.lineNumber() + ")");
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "OwlBotNative");

        tts = new TextToSpeech(this, status -> {
            ttsReady = (status == TextToSpeech.SUCCESS);
            if (ttsReady) {
                tts.setLanguage(Locale.getDefault());
                // Small creature: higher pitch, slightly quick.
                tts.setPitch(1.45f);
                tts.setSpeechRate(1.02f);

                // The face lip-syncs to these. onRangeStart fires per word,
                // which is more than enough to drive a mouth convincingly and
                // costs nothing compared to real viseme analysis.
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) {
                        toJs("onSpeechStart", "");
                    }
                    @Override public void onDone(String id) {
                        toJs("onSpeechEnd", "");
                    }
                    @Override public void onError(String id) {
                        toJs("onSpeechEnd", "");
                    }
                    @Override
                    public void onRangeStart(String id, int start, int end, int frame) {
                        // word boundary -> one mouth flap
                        toJs("onSpeechRange", String.valueOf(end - start));
                    }
                });
            }
            Log.i(TAG, "tts ready=" + ttsReady);
            main.post(() -> web.evaluateJavascript(
                    "if(window.onTtsReady)window.onTtsReady(" + ttsReady + ");", null));
        });

        // Camera and microphone permissions are requested only when the user
        // explicitly enables that sense in the page.
        web.loadUrl(PAGE);
    }

    // ------------------------------------------------------------ permissions

    private void askForSenses(boolean wantCamera, boolean wantMicrophone) {
        List<String> need = new ArrayList<>();
        if (wantCamera && !granted(Manifest.permission.CAMERA)) {
            need.add(Manifest.permission.CAMERA);
        }
        if (wantMicrophone && !granted(Manifest.permission.RECORD_AUDIO)) {
            need.add(Manifest.permission.RECORD_AUDIO);
        }
        if (!need.isEmpty()) {
            requestPermissions(need.toArray(new String[0]), REQ_PERMS);
        }
    }

    private void askForHardwareSensors() {
        hardwareSensorsPaused = false;
        List<String> need = new ArrayList<>();
        if (!granted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            need.add(Manifest.permission.ACCESS_FINE_LOCATION);
            need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && !granted(Manifest.permission.ACTIVITY_RECOGNITION)) {
            need.add(Manifest.permission.ACTIVITY_RECOGNITION);
        }
        if (!need.isEmpty()) {
            requestPermissions(need.toArray(new String[0]), REQ_PERMS);
        } else {
            if (!hardwareSensorsPaused) {
                startHardwareSensors();
                startLocationUpdates();
            }
        }
    }

    private boolean granted(String p) {
        return checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED;
    }

    private void handleWebPermission(PermissionRequest request) {
        if (request.getOrigin() == null
                || !"file".equalsIgnoreCase(request.getOrigin().getScheme())) {
            Log.w(TAG, "denied WebView permission from " + request.getOrigin());
            request.deny();
            return;
        }
        List<String> allow = new ArrayList<>();
        boolean wantsCamera = false;
        boolean wantsMicrophone = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                wantsCamera = true;
                if (granted(Manifest.permission.CAMERA)) allow.add(r);
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                wantsMicrophone = true;
                if (granted(Manifest.permission.RECORD_AUDIO)) allow.add(r);
            }
        }
        if (allow.size() == request.getResources().length) {
            request.grant(allow.toArray(new String[0]));
        } else {
            // Hold it, ask the OS, and replay once the user has answered.
            pendingWebRequest = request;
            askForSenses(wantsCamera, wantsMicrophone);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code == REQ_PERMS) {
            if (pendingWebRequest != null) {
                PermissionRequest r = pendingWebRequest;
                pendingWebRequest = null;
                handleWebPermission(r);
            }
            if (pendingSpeechListen) {
                pendingSpeechListen = false;
                if (granted(Manifest.permission.RECORD_AUDIO)) {
                    startListening();
                }
            }
            if (!hardwareSensorsPaused) {
                startHardwareSensors();
                startLocationUpdates();
            }
        }
    }

    // ------------------------------------------------------ native sensors

    private void registerSensor(int type, int delay, String label) {
        if (sensorManager == null) return;
        Sensor sensor = sensorManager.getDefaultSensor(type);
        if (sensor == null) return;
        try {
            if (sensorManager.registerListener(this, sensor, delay)) {
                synchronized (sensorLock) {
                    activeSensors.add(label + " (" + sensor.getName() + ")");
                }
            }
        } catch (SecurityException e) {
            Log.w(TAG, "sensor permission denied for " + label);
        }
    }

    private void startHardwareSensors() {
        if (sensorManager == null || hardwareSensorsPaused) return;
        sensorManager.unregisterListener(this);
        synchronized (sensorLock) {
            activeSensors.clear();
        }
        int motionDelay = sensorLowPower
                ? SensorManager.SENSOR_DELAY_NORMAL : SensorManager.SENSOR_DELAY_GAME;
        int orientationDelay = sensorLowPower
                ? SensorManager.SENSOR_DELAY_NORMAL : SensorManager.SENSOR_DELAY_UI;
        registerSensor(Sensor.TYPE_ACCELEROMETER, motionDelay, "accelerometer");
        registerSensor(Sensor.TYPE_GYROSCOPE, motionDelay, "gyroscope");
        registerSensor(Sensor.TYPE_MAGNETIC_FIELD, orientationDelay, "magnetometer");
        registerSensor(Sensor.TYPE_ROTATION_VECTOR, orientationDelay, "absolute rotation");
        registerSensor(Sensor.TYPE_GRAVITY, orientationDelay, "gravity");
        registerSensor(Sensor.TYPE_LINEAR_ACCELERATION, motionDelay, "linear acceleration");
        registerSensor(Sensor.TYPE_LIGHT, SensorManager.SENSOR_DELAY_NORMAL, "ambient light");
        registerSensor(Sensor.TYPE_PRESSURE, SensorManager.SENSOR_DELAY_NORMAL, "barometer");
        registerSensor(Sensor.TYPE_PROXIMITY, SensorManager.SENSOR_DELAY_NORMAL, "proximity");
        registerSensor(Sensor.TYPE_AMBIENT_TEMPERATURE, SensorManager.SENSOR_DELAY_NORMAL,
                "ambient temperature");
        registerSensor(Sensor.TYPE_RELATIVE_HUMIDITY, SensorManager.SENSOR_DELAY_NORMAL,
                "relative humidity");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(Manifest.permission.ACTIVITY_RECOGNITION)) {
            registerSensor(Sensor.TYPE_STEP_COUNTER, SensorManager.SENSOR_DELAY_NORMAL, "step counter");
        }
    }

    private static void copyVector(float[] destination, float[] source) {
        int count = Math.min(destination.length, source.length);
        System.arraycopy(source, 0, destination, 0, count);
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        synchronized (sensorLock) {
            nativeSensorAt = System.currentTimeMillis();
            switch (event.sensor.getType()) {
                case Sensor.TYPE_ACCELEROMETER:
                    copyVector(nativeAccel, event.values);
                    break;
                case Sensor.TYPE_GYROSCOPE:
                    copyVector(nativeGyro, event.values);
                    break;
                case Sensor.TYPE_MAGNETIC_FIELD:
                    copyVector(nativeMagnetic, event.values);
                    break;
                case Sensor.TYPE_GRAVITY:
                    copyVector(nativeGravity, event.values);
                    break;
                case Sensor.TYPE_LINEAR_ACCELERATION:
                    copyVector(nativeLinearAccel, event.values);
                    break;
                case Sensor.TYPE_ROTATION_VECTOR:
                    float[] matrix = new float[9];
                    float[] angles = new float[3];
                    SensorManager.getRotationMatrixFromVector(matrix, event.values);
                    SensorManager.getOrientation(matrix, angles);
                    nativeOrientation[0] = (float) Math.toDegrees(angles[0]);
                    nativeOrientation[1] = (float) Math.toDegrees(angles[1]);
                    nativeOrientation[2] = (float) Math.toDegrees(angles[2]);
                    break;
                case Sensor.TYPE_LIGHT:
                    nativeLight = event.values[0];
                    break;
                case Sensor.TYPE_PRESSURE:
                    nativePressure = event.values[0];
                    break;
                case Sensor.TYPE_PROXIMITY:
                    nativeProximity = event.values[0];
                    break;
                case Sensor.TYPE_AMBIENT_TEMPERATURE:
                    nativeAmbientTemp = event.values[0];
                    break;
                case Sensor.TYPE_RELATIVE_HUMIDITY:
                    nativeHumidity = event.values[0];
                    break;
                case Sensor.TYPE_STEP_COUNTER:
                    nativeSteps = event.values[0];
                    break;
                default:
                    break;
            }
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Each reading remains useful with its hardware-reported precision.
    }

    @SuppressLint("MissingPermission")
    private void startLocationUpdates() {
        if (hardwareSensorsPaused || locationManager == null
                || (!granted(Manifest.permission.ACCESS_FINE_LOCATION)
                    && !granted(Manifest.permission.ACCESS_COARSE_LOCATION))) {
            locationUpdates = false;
            return;
        }
        stopLocationUpdates();
        try {
            Location best = null;
            for (String provider : new String[] {
                    LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
                if (!locationManager.isProviderEnabled(provider)) continue;
                Location known = locationManager.getLastKnownLocation(provider);
                if (known != null && (best == null || known.getTime() > best.getTime())) {
                    best = known;
                }
                long intervalMs = sensorLowPower ? 60000L : 15000L;
                float distanceM = sensorLowPower ? 10.0f : 3.0f;
                locationManager.requestLocationUpdates(provider, intervalMs, distanceM, this,
                        Looper.getMainLooper());
                locationUpdates = true;
            }
            if (best != null) lastLocation = best;
        } catch (Exception e) {
            locationUpdates = false;
            Log.w(TAG, "location unavailable: " + e.getClass().getSimpleName());
        }
    }

    private void stopLocationUpdates() {
        if (locationManager == null) return;
        try {
            locationManager.removeUpdates(this);
        } catch (Exception ignored) {
        }
        locationUpdates = false;
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location != null) lastLocation = location;
    }

    @Override public void onProviderEnabled(String provider) {
        startLocationUpdates();
    }
    @Override public void onProviderDisabled(String provider) {
        // Keep the most recent fix but report whether providers are enabled.
    }
    @SuppressWarnings("deprecation")
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    private static JSONArray vectorJson(float[] values) {
        JSONArray out = new JSONArray();
        for (float value : values) {
            out.put(Float.isFinite(value) ? Math.round(value * 10000.0) / 10000.0
                                          : JSONObject.NULL);
        }
        return out;
    }

    private static void putFinite(JSONObject object, String key, float value) throws Exception {
        if (Float.isFinite(value)) {
            object.put(key, Math.round(value * 100.0) / 100.0);
        }
    }

    private String thermalName(int status) {
        switch (status) {
            case PowerManager.THERMAL_STATUS_NONE: return "none";
            case PowerManager.THERMAL_STATUS_LIGHT: return "light";
            case PowerManager.THERMAL_STATUS_MODERATE: return "moderate";
            case PowerManager.THERMAL_STATUS_SEVERE: return "severe";
            case PowerManager.THERMAL_STATUS_CRITICAL: return "critical";
            case PowerManager.THERMAL_STATUS_EMERGENCY: return "emergency";
            case PowerManager.THERMAL_STATUS_SHUTDOWN: return "shutdown";
            default: return "unknown";
        }
    }

    private String hardwareSnapshotJson() {
        try {
            JSONObject root = new JSONObject();
            root.put("capturedAt", System.currentTimeMillis());
            root.put("sensorMode", hardwareSensorsPaused ? "paused" : (sensorLowPower ? "low" : "full"));
            JSONObject motion = new JSONObject();
            synchronized (sensorLock) {
                motion.put("sampleAt", nativeSensorAt);
                motion.put("accelerationMps2", vectorJson(nativeAccel));
                motion.put("linearAccelerationMps2", vectorJson(nativeLinearAccel));
                motion.put("gravityMps2", vectorJson(nativeGravity));
                motion.put("gyroscopeRadS", vectorJson(nativeGyro));
                motion.put("magneticFieldUt", vectorJson(nativeMagnetic));
                motion.put("orientationDegAzimuthPitchRoll", vectorJson(nativeOrientation));
                putFinite(motion, "stepsSinceBoot", nativeSteps);
                JSONArray available = new JSONArray();
                for (String name : activeSensors) available.put(name);
                root.put("availableSensors", available);

                JSONObject environment = new JSONObject();
                putFinite(environment, "lightLux", nativeLight);
                putFinite(environment, "pressureHpa", nativePressure);
                putFinite(environment, "proximityCm", nativeProximity);
                putFinite(environment, "ambientTemperatureC", nativeAmbientTemp);
                putFinite(environment, "relativeHumidityPercent", nativeHumidity);
                root.put("environment", environment);
            }
            root.put("motion", motion);

            JSONObject battery = new JSONObject();
            Intent state = registerReceiver(null,
                    new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (state != null) {
                int level = state.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                int scale = state.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                if (level >= 0 && scale > 0) {
                    battery.put("levelPercent", Math.round(level * 1000.0 / scale) / 10.0);
                }
                int temp = state.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, Integer.MIN_VALUE);
                if (temp != Integer.MIN_VALUE) battery.put("batteryTemperatureC", temp / 10.0);
                int millivolts = state.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1);
                if (millivolts > 0) battery.put("voltageV", millivolts / 1000.0);
                battery.put("plugged", state.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
            }
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int thermal = power.getCurrentThermalStatus();
                battery.put("thermalStatus", thermalName(thermal));
                battery.put("thermalStatusCode", thermal);
            }
            root.put("phonePower", battery);

            JSONObject position = new JSONObject();
            boolean locationPermission = granted(Manifest.permission.ACCESS_FINE_LOCATION)
                    || granted(Manifest.permission.ACCESS_COARSE_LOCATION);
            position.put("permission", locationPermission);
            position.put("updatesActive", locationUpdates);
            if (locationManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                position.put("servicesEnabled", locationManager.isLocationEnabled());
            }
            Location location = lastLocation;
            if (location != null) {
                position.put("provider", location.getProvider());
                position.put("latitude", location.getLatitude());
                position.put("longitude", location.getLongitude());
                position.put("accuracyM", location.getAccuracy());
                position.put("time", location.getTime());
                if (location.hasAltitude()) position.put("altitudeM", location.getAltitude());
                if (location.hasSpeed()) position.put("speedMps", location.getSpeed());
                if (location.hasBearing()) position.put("bearingDeg", location.getBearing());
            }
            root.put("position", position);
            return root.toString();
        } catch (Exception e) {
            Log.w(TAG, "sensor snapshot failed: " + e.getClass().getSimpleName());
            return "{\"error\":\"sensor snapshot unavailable\"}";
        }
    }

    // ------------------------------------------------------ internet tools

    private String httpGet(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(10000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "OwlBot/1.4 local Android assistant");
        try {
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream() : connection.getErrorStream();
            if (stream == null) throw new Exception("HTTP " + status);
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder text = new StringBuilder();
            char[] buffer = new char[4096];
            int count;
            while ((count = reader.read(buffer)) >= 0 && text.length() < 600_000) {
                text.append(buffer, 0, count);
            }
            if (status < 200 || status >= 300) {
                throw new Exception("HTTP " + status + " " + text.substring(0, Math.min(160, text.length())));
            }
            return text.toString();
        } finally {
            connection.disconnect();
        }
    }

    private String plainText(String html) {
        if (html == null) return "";
        return Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString()
                .replaceAll("\\s+", " ").trim();
    }

    private void appendDuckTopics(JSONArray topics, JSONArray results, Set<String> seen)
            throws Exception {
        if (topics == null || results.length() >= 5) return;
        for (int i = 0; i < topics.length() && results.length() < 5; i++) {
            JSONObject item = topics.optJSONObject(i);
            if (item == null) continue;
            if (item.has("Topics")) {
                appendDuckTopics(item.optJSONArray("Topics"), results, seen);
                continue;
            }
            String text = plainText(item.optString("Text"));
            String url = item.optString("FirstURL");
            if (text.isEmpty() || url.isEmpty() || !seen.add(url)) continue;
            JSONObject result = new JSONObject();
            result.put("title", text.length() > 90 ? text.substring(0, 90) : text);
            result.put("snippet", text);
            result.put("url", url);
            result.put("source", "DuckDuckGo");
            results.put(result);
        }
    }

    private String sourceHost(String address) {
        try {
            String host = new URL(address).getHost();
            return host.startsWith("www.") ? host.substring(4) : host;
        } catch (Exception ignored) {
            return "web";
        }
    }

    private int appendBraveWebResults(String html, JSONArray results, Set<String> seen)
            throws Exception {
        int before = results.length();
        Pattern blocks = Pattern.compile(
                "(?is)<div class=\"snippet [^\"]*\"[^>]*data-type=\"web\"[^>]*>"
                        + "(.*?)(?=<div class=\"snippet [^\"]*\"[^>]*data-type=\"web\"|\\z)");
        Pattern linkPattern = Pattern.compile(
                "(?is)<a href=\"(https?://[^\"]+)\"[^>]*class=\"[^\"]*\\bl1\\b[^\"]*\"");
        Pattern titlePattern = Pattern.compile(
                "(?is)class=\"title search-snippet-title[^\"]*\"[^>]*title=\"([^\"]+)\"");
        Pattern snippetPattern = Pattern.compile(
                "(?is)class=\"content desktop-default-regular[^\"]*\"[^>]*>(.*?)</div>");
        Matcher blockMatcher = blocks.matcher(html == null ? "" : html);
        while (blockMatcher.find() && results.length() < 6) {
            String block = blockMatcher.group(1);
            Matcher linkMatch = linkPattern.matcher(block);
            Matcher titleMatch = titlePattern.matcher(block);
            if (!linkMatch.find() || !titleMatch.find()) continue;
            String link = plainText(linkMatch.group(1));
            if (!seen.add(link)) continue;
            Matcher snippetMatch = snippetPattern.matcher(block);
            JSONObject item = new JSONObject();
            item.put("title", plainText(titleMatch.group(1)));
            item.put("snippet", snippetMatch.find() ? plainText(snippetMatch.group(1)) : "");
            item.put("url", link);
            item.put("source", sourceHost(link));
            item.put("foundBy", "Brave Web Search");
            results.put(item);
        }
        return results.length() - before;
    }

    private void appendBingWebResults(String rss, JSONArray results, Set<String> seen)
            throws Exception {
        XmlPullParser parser = Xml.newPullParser();
        parser.setInput(new StringReader(rss));
        boolean inItem = false;
        String title = "", link = "", description = "";
        int event = parser.getEventType();
        while (event != XmlPullParser.END_DOCUMENT && results.length() < 6) {
            if (event == XmlPullParser.START_TAG) {
                String tag = parser.getName();
                if ("item".equalsIgnoreCase(tag)) {
                    inItem = true;
                    title = link = description = "";
                } else if (inItem && "title".equalsIgnoreCase(tag)) {
                    title = parser.nextText();
                } else if (inItem && "link".equalsIgnoreCase(tag)) {
                    link = parser.nextText();
                } else if (inItem && "description".equalsIgnoreCase(tag)) {
                    description = parser.nextText();
                }
            } else if (event == XmlPullParser.END_TAG
                    && "item".equalsIgnoreCase(parser.getName())) {
                inItem = false;
                title = plainText(title);
                description = plainText(description);
                link = link == null ? "" : link.trim();
                if (!title.isEmpty() && link.startsWith("http") && seen.add(link)) {
                    JSONObject item = new JSONObject();
                    item.put("title", title);
                    item.put("snippet", description);
                    item.put("url", link);
                    item.put("source", sourceHost(link));
                    item.put("foundBy", "Bing Web Search");
                    results.put(item);
                }
            }
            event = parser.next();
        }
    }

    private String webSearchJson(String rawQuery) throws Exception {
        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.isEmpty()) throw new Exception("search query is empty");
        if (query.length() > 180) query = query.substring(0, 180);
        String encoded = URLEncoder.encode(query, StandardCharsets.UTF_8.name());
        JSONObject output = new JSONObject();
        output.put("query", query);
        JSONArray results = new JSONArray();
        Set<String> seen = new LinkedHashSet<>();
        JSONArray providerErrors = new JSONArray();
        JSONArray providers = new JSONArray();

        try {
            int found = appendBraveWebResults(httpGet("https://search.brave.com/search?q="
                    + encoded + "&source=web"), results, seen);
            if (found == 0) throw new Exception("no web results parsed");
            providers.put("Brave Web Search");
        } catch (Exception e) {
            providerErrors.put("Brave Web Search: " + e.getMessage());
        }

        try {
            appendBingWebResults(httpGet("https://www.bing.com/search?q=" + encoded
                    + "&format=rss"), results, seen);
            providers.put("Bing Web Search");
        } catch (Exception e) {
            providerErrors.put("Bing Web Search: " + e.getMessage());
        }

        try {
            JSONObject duck = new JSONObject(httpGet(
                    "https://api.duckduckgo.com/?q=" + encoded
                            + "&format=json&no_html=1&no_redirect=1&skip_disambig=0"));
            String answer = plainText(duck.optString("Answer"));
            if (!answer.isEmpty()) output.put("instantAnswer", answer);
            String abstractText = plainText(duck.optString("AbstractText"));
            String abstractUrl = duck.optString("AbstractURL");
            if (!abstractText.isEmpty()) {
                JSONObject item = new JSONObject();
                item.put("title", duck.optString("Heading", query));
                item.put("snippet", abstractText);
                item.put("url", abstractUrl);
                item.put("source", duck.optString("AbstractSource", "DuckDuckGo"));
                results.put(item);
                if (!abstractUrl.isEmpty()) seen.add(abstractUrl);
            }
            appendDuckTopics(duck.optJSONArray("RelatedTopics"), results, seen);
            providers.put("DuckDuckGo Instant Answers");
        } catch (Exception e) {
            providerErrors.put("DuckDuckGo Instant Answers: " + e.getMessage());
        }

        try {
            JSONObject wiki = new JSONObject(httpGet(
                    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch="
                            + encoded + "&srlimit=5&format=json&utf8=1&origin=*"));
            JSONArray hits = wiki.optJSONObject("query") == null ? null
                    : wiki.optJSONObject("query").optJSONArray("search");
            if (hits != null) for (int i = 0; i < hits.length() && results.length() < 8; i++) {
                JSONObject hit = hits.optJSONObject(i);
                if (hit == null) continue;
                String url = "https://en.wikipedia.org/?curid=" + hit.optLong("pageid");
                if (!seen.add(url)) continue;
                JSONObject item = new JSONObject();
                item.put("title", hit.optString("title"));
                item.put("snippet", plainText(hit.optString("snippet")));
                item.put("url", url);
                item.put("source", "Wikipedia");
                results.put(item);
            }
            providers.put("Wikipedia Search");
        } catch (Exception e) {
            providerErrors.put("Wikipedia: " + e.getMessage());
        }
        output.put("providers", providers);
        output.put("results", results);
        if (providerErrors.length() > 0) output.put("providerErrors", providerErrors);
        output.put("fetchedAt", System.currentTimeMillis());
        if (results.length() == 0 && !output.has("instantAnswer"))
            output.put("message", "No useful result was returned; refine the query or answer from existing knowledge.");
        return output.toString();
    }

    private String newsSearchJson(String rawQuery) throws Exception {
        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.length() > 180) query = query.substring(0, 180);
        String address = "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
        if (!query.isEmpty()) {
            address = "https://news.google.com/rss/search?q="
                    + URLEncoder.encode(query, StandardCharsets.UTF_8.name())
                    + "&hl=en-US&gl=US&ceid=US:en";
        }
        XmlPullParser parser = Xml.newPullParser();
        parser.setInput(new StringReader(httpGet(address)));
        JSONArray results = new JSONArray();
        boolean inItem = false;
        String title = "", link = "", description = "", published = "", publisher = "";
        int event = parser.getEventType();
        while (event != XmlPullParser.END_DOCUMENT && results.length() < 10) {
            if (event == XmlPullParser.START_TAG) {
                String tag = parser.getName();
                if ("item".equalsIgnoreCase(tag)) {
                    inItem = true;
                    title = link = description = published = publisher = "";
                } else if (inItem && "title".equalsIgnoreCase(tag)) {
                    title = parser.nextText();
                } else if (inItem && "link".equalsIgnoreCase(tag)) {
                    link = parser.nextText();
                } else if (inItem && "description".equalsIgnoreCase(tag)) {
                    description = parser.nextText();
                } else if (inItem && "pubDate".equalsIgnoreCase(tag)) {
                    published = parser.nextText();
                } else if (inItem && "source".equalsIgnoreCase(tag)) {
                    publisher = parser.nextText();
                }
            } else if (event == XmlPullParser.END_TAG
                    && "item".equalsIgnoreCase(parser.getName())) {
                inItem = false;
                JSONObject item = new JSONObject();
                item.put("title", plainText(title));
                item.put("snippet", plainText(description));
                item.put("url", link == null ? "" : link.trim());
                item.put("source", plainText(publisher));
                item.put("published", published);
                item.put("foundBy", "Google News");
                results.put(item);
            }
            event = parser.next();
        }
        JSONObject output = new JSONObject();
        output.put("query", query);
        output.put("provider", "Google News");
        output.put("results", results);
        output.put("fetchedAt", System.currentTimeMillis());
        if (results.length() == 0) output.put("message", "No matching news headlines were returned.");
        return output.toString();
    }

    private String weatherJson(double latitude, double longitude) throws Exception {
        if (!Double.isFinite(latitude) || !Double.isFinite(longitude)
                || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
            throw new Exception("invalid coordinates");
        String location = String.format(Locale.US, "latitude=%.6f&longitude=%.6f",
                latitude, longitude);
        String fields = "current=temperature_2m,relative_humidity_2m,apparent_temperature,"
                + "is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,"
                + "wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,"
                + "temperature_2m_min,apparent_temperature_max,apparent_temperature_min,"
                + "sunrise,sunset,precipitation_sum,precipitation_probability_max,"
                + "wind_speed_10m_max";
        JSONObject weather = new JSONObject(httpGet("https://api.open-meteo.com/v1/forecast?"
                + location + "&" + fields
                + "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch"
                + "&timezone=auto&forecast_days=2"));
        JSONObject output = new JSONObject();
        output.put("provider", "Open-Meteo");
        output.put("requestedLatitude", latitude);
        output.put("requestedLongitude", longitude);
        output.put("timezone", weather.optString("timezone"));
        output.put("timezoneAbbreviation", weather.optString("timezone_abbreviation"));
        output.put("currentUnits", weather.optJSONObject("current_units"));
        output.put("current", weather.optJSONObject("current"));
        output.put("dailyUnits", weather.optJSONObject("daily_units"));
        output.put("daily", weather.optJSONObject("daily"));
        output.put("fetchedAt", System.currentTimeMillis());
        return output.toString();
    }

    private boolean appToolsAllowedValue() {
        return getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
                .getBoolean("app_tools_allowed", false);
    }

    private void saveAppToolsAllowed(boolean allowed) {
        getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE).edit()
                .putBoolean("app_tools_allowed", allowed).apply();
    }

    private static final class AppCandidate {
        final String label;
        final String packageName;
        final int score;
        AppCandidate(String label, String packageName, int score) {
            this.label = label;
            this.packageName = packageName;
            this.score = score;
        }
    }

    private String normalizedAppName(String value) {
        return String.valueOf(value == null ? "" : value).toLowerCase(Locale.US)
                .replaceAll("\\b(?:open|launch|start|run|please|the|app|application|game)\\b", " ")
                .replaceAll("[^a-z0-9]+", " ").trim().replaceAll("\\s+", " ");
    }

    private String knownAppPackage(String query) {
        String app = normalizedAppName(query);
        if ("google".equals(app) || "google search".equals(app))
            return "com.google.android.googlequicksearchbox";
        if ("chrome".equals(app) || "google chrome".equals(app))
            return "com.android.chrome";
        if ("pandora".equals(app)) return "com.pandora.android";
        if ("email".equals(app) || "mail".equals(app) || "gmail".equals(app))
            return "com.google.android.gm";
        return null;
    }

    private List<AppCandidate> findLaunchableApps(String rawQuery, int limit) {
        String query = normalizedAppName(rawQuery);
        List<AppCandidate> found = new ArrayList<>();
        if (query.isEmpty()) return found;
        PackageManager pm = getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN, null);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        Set<String> seen = new LinkedHashSet<>();
        for (ResolveInfo info : pm.queryIntentActivities(launcher, PackageManager.MATCH_ALL)) {
            if (info.activityInfo == null || info.activityInfo.packageName == null) continue;
            String pkg = info.activityInfo.packageName;
            if (!seen.add(pkg) || getPackageName().equals(pkg)) continue;
            CharSequence loaded = info.loadLabel(pm);
            String label = loaded == null ? pkg : loaded.toString().trim();
            String name = normalizedAppName(label);
            String pkgText = normalizedAppName(pkg.replace('.', ' '));
            int score = 0;
            if (query.equals(name) || query.equals(pkgText)) score = 100;
            else if (query.endsWith(" " + name) || name.endsWith(" " + query)
                    || query.startsWith(name + " ") || name.startsWith(query + " ")) score = 92;
            else if (name.contains(query) || query.contains(name)) score = 84;
            else {
                int matches = 0;
                for (String token : query.split(" "))
                    if (token.length() > 1 && (name.contains(token) || pkgText.contains(token))) matches++;
                if (matches > 0) score = 45 + matches * 10;
            }
            if (score > 0) found.add(new AppCandidate(label, pkg, score));
        }
        found.sort((a, b) -> b.score != a.score ? b.score - a.score
                : a.label.compareToIgnoreCase(b.label));
        if (found.size() > limit) return new ArrayList<>(found.subList(0, limit));
        return found;
    }

    private AppCandidate resolveLaunchableApp(String query) {
        String known = knownAppPackage(query);
        if (known != null) {
            Intent launch = getPackageManager().getLaunchIntentForPackage(known);
            if (launch != null) {
                try {
                    String label = getPackageManager().getApplicationLabel(
                            getPackageManager().getApplicationInfo(known, 0)).toString();
                    return new AppCandidate(label, known, 110);
                } catch (Exception ignored) {
                    return new AppCandidate(query, known, 110);
                }
            }
        }
        List<AppCandidate> matches = findLaunchableApps(query, 1);
        return matches.isEmpty() ? null : matches.get(0);
    }

    private Intent launchIntentFor(String app) {
        AppCandidate match = resolveLaunchableApp(app);
        return match == null ? null
                : getPackageManager().getLaunchIntentForPackage(match.packageName);
    }

    private JSONArray appMatchesJson(String query, int limit) throws Exception {
        JSONArray matches = new JSONArray();
        for (AppCandidate candidate : findLaunchableApps(query, limit)) {
            JSONObject item = new JSONObject();
            item.put("label", candidate.label);
            item.put("package", candidate.packageName);
            item.put("score", candidate.score);
            matches.put(item);
        }
        return matches;
    }

    private String appCapabilitiesJson() {
        try {
            JSONObject out = new JSONObject();
            out.put("permission", appToolsAllowedValue());
            out.put("google", launchIntentFor("google") != null);
            out.put("chrome", launchIntentFor("chrome") != null);
            out.put("pandora", launchIntentFor("pandora") != null);
            out.put("email", launchIntentFor("email") != null);
            Intent launcher = new Intent(Intent.ACTION_MAIN, null);
            launcher.addCategory(Intent.CATEGORY_LAUNCHER);
            out.put("launchableAppCount", getPackageManager()
                    .queryIntentActivities(launcher, PackageManager.MATCH_ALL).size());
            return out.toString();
        } catch (Exception e) {
            return "{\"error\":\"capability check failed\"}";
        }
    }

    private String externalAppAction(String action, String payload) {
        JSONObject result = new JSONObject();
        try {
            if (!appToolsAllowedValue()) {
                result.put("ok", false);
                result.put("error", "app tools are locked by the owner");
                return result.toString();
            }
            JSONObject args = payload == null || payload.isEmpty()
                    ? new JSONObject() : new JSONObject(payload);
            Intent intent = null;
            String message;
            if ("find_phone_apps".equals(action)) {
                String query = args.optString("query").trim();
                if (query.isEmpty()) throw new Exception("app search is empty");
                JSONArray matches = appMatchesJson(query, 8);
                result.put("ok", true);
                result.put("query", query);
                result.put("matches", matches);
                result.put("message", matches.length() == 0
                        ? "no launchable app matched locally"
                        : "found " + matches.length() + " local app match"
                          + (matches.length() == 1 ? "" : "es"));
                return result.toString();
            } else if ("open_phone_app".equals(action)) {
                String app = args.optString("app").trim();
                AppCandidate match = resolveLaunchableApp(app);
                if (match == null) throw new Exception("no launchable app matched: " + app);
                intent = getPackageManager().getLaunchIntentForPackage(match.packageName);
                if (intent == null) throw new Exception("matched app has no launch activity: " + match.label);
                message = "opened " + match.label;
            } else if ("google_search_app".equals(action)) {
                String query = args.optString("query").trim();
                if (query.isEmpty()) throw new Exception("Google query is empty");
                intent = new Intent(Intent.ACTION_WEB_SEARCH);
                intent.setPackage("com.google.android.googlequicksearchbox");
                intent.putExtra(SearchManager.QUERY, query);
                if (intent.resolveActivity(getPackageManager()) == null) {
                    intent = new Intent(Intent.ACTION_VIEW,
                            Uri.parse("https://www.google.com/search?q=" + Uri.encode(query)));
                    intent.setPackage("com.android.chrome");
                }
                message = "opened Google results for the requested query";
            } else if ("play_on_pandora".equals(action)) {
                String query = args.optString("query").trim();
                if (query.isEmpty()) throw new Exception("Pandora request is empty");
                intent = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
                intent.setPackage("com.pandora.android");
                intent.putExtra(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Media.ENTRY_CONTENT_TYPE);
                intent.putExtra(SearchManager.QUERY, query);
                if (intent.resolveActivity(getPackageManager()) == null) {
                    intent = launchIntentFor("pandora");
                    message = "opened Pandora; this Pandora build did not accept a direct play request";
                } else {
                    message = "handed the play request to Pandora";
                }
                if (intent == null) throw new Exception("Pandora is not installed");
            } else if ("compose_email".equals(action)) {
                String to = args.optString("to").trim();
                String subject = args.optString("subject");
                String body = args.optString("body");
                String mailto = "mailto:" + Uri.encode(to) + "?subject=" + Uri.encode(subject)
                        + "&body=" + Uri.encode(body);
                intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(mailto));
                message = "opened an email draft; the owner must review and send it";
            } else if ("media_control".equals(action)) {
                String command = args.optString("command").toLowerCase(Locale.US);
                int key;
                if ("play_pause".equals(command)) key = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
                else if ("next".equals(command)) key = KeyEvent.KEYCODE_MEDIA_NEXT;
                else if ("previous".equals(command)) key = KeyEvent.KEYCODE_MEDIA_PREVIOUS;
                else if ("stop".equals(command)) key = KeyEvent.KEYCODE_MEDIA_STOP;
                else throw new Exception("unsupported media command");
                AudioManager audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, key));
                audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, key));
                result.put("ok", true);
                result.put("message", "sent media command " + command);
                return result.toString();
            } else {
                throw new Exception("unsupported app action");
            }
            if (intent.resolveActivity(getPackageManager()) == null)
                throw new Exception("no installed app can handle this request");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            final Intent launch = intent;
            main.post(() -> startActivity(launch));
            result.put("ok", true);
            result.put("message", message);
        } catch (Exception e) {
            try {
                result.put("ok", false);
                result.put("error", e.getMessage());
            } catch (Exception ignored) {}
        }
        return result.toString();
    }

    private void sendInternetResult(String requestId, String kind, String result, Exception error) {
        try {
            JSONObject envelope = new JSONObject();
            envelope.put("id", requestId == null ? "" : requestId);
            envelope.put("kind", kind);
            if (error == null) envelope.put("result", new JSONObject(result));
            else envelope.put("error", error.getClass().getSimpleName() + ": " + error.getMessage());
            toJs("onInternetResult", envelope.toString());
        } catch (Exception e) {
            toJs("onInternetResult", "{\"error\":\"internet result encoding failed\"}");
        }
    }

    // ------------------------------------------------------------ the bridge

    /** Exposed to the page as window.OwlBotNative. */
    public class Bridge {

        private final FaceDetector localFaceDetector = FaceDetection.getClient(
                new FaceDetectorOptions.Builder()
                        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
                        .setMinFaceSize(0.12f)
                        .build());

        @JavascriptInterface
        public boolean available() {
            return true;
        }

        @JavascriptInterface
        public boolean saveSecret(String name, String value) {
            return saveSecretValue(name, value);
        }

        @JavascriptInterface
        public String loadSecret(String name) {
            return loadSecretValue(name);
        }

        @JavascriptInterface
        public void clearSecrets() {
            getSharedPreferences(SECRET_PREFS, MODE_PRIVATE).edit().clear().apply();
        }

        @JavascriptInterface
        public void speak(final String text) {
            if (text == null || text.trim().isEmpty()) return;
            if (!ttsReady) { Log.w(TAG, "speak before tts ready: " + text); return; }
            main.post(() -> {
                Bundle p = new Bundle();
                p.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "owlbot");
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, "owlbot");
            });
        }

        /** Higher pitch and rate make it read younger; the page exposes this. */
        @JavascriptInterface
        public void voice(final float pitch, final float rate) {
            main.post(() -> {
                if (!ttsReady) return;
                tts.setPitch(Math.max(0.5f, Math.min(2.0f, pitch)));
                tts.setSpeechRate(Math.max(0.5f, Math.min(2.0f, rate)));
            });
        }

        @JavascriptInterface
        public boolean ttsReady() {
            return ttsReady;
        }

        @JavascriptInterface
        public void stopSpeaking() {
            main.post(() -> { if (ttsReady) tts.stop(); });
        }

        /** Listen once; the result comes back as window.onNativeSpeech(text). */
        @JavascriptInterface
        public void listen() {
            main.post(() -> startListening());
        }

        /** Start one push-to-talk recognition session. */
        @JavascriptInterface
        public void beginPushToTalk() {
            main.post(() -> {
                micPaused = false;
                startListening();
            });
        }

        /** Stop recording and ask SpeechRecognizer to return the phrase. */
        @JavascriptInterface
        public void endPushToTalk() {
            main.post(() -> {
                pendingSpeechListen = false;
                finishListening();
            });
        }

        /** Cancel any active capture without submitting it. */
        @JavascriptInterface
        public void setMicPaused(final boolean paused) {
            main.post(() -> {
                micPaused = paused;
                if (paused) {
                    pendingSpeechListen = false;
                    stopListening();
                }
            });
        }

        @JavascriptInterface
        public boolean micPaused() {
            return micPaused;
        }

        /** Request optional location/step permissions and start every safe sensor. */
        @JavascriptInterface
        public void enableSensors() {
            main.post(() -> askForHardwareSensors());
        }

        /** Suspend continuous sensor and GPS work while OwlBot rests or cools. */
        @JavascriptInterface
        public void pauseHardwareSensors() {
            main.post(() -> {
                hardwareSensorsPaused = true;
                if (sensorManager != null) sensorManager.unregisterListener(MainActivity.this);
                synchronized (sensorLock) { activeSensors.clear(); }
                stopLocationUpdates();
            });
        }

        /** Resume sensors after a deliberate wake and a safe thermal recovery. */
        @JavascriptInterface
        public void resumeHardwareSensors() {
            main.post(() -> {
                hardwareSensorsPaused = false;
                startHardwareSensors();
                startLocationUpdates();
            });
        }

        /** Reduce Android sensor and GPS cadence without losing basic awareness. */
        @JavascriptInterface
        public void setSensorLowPower(final boolean lowPower) {
            main.post(() -> {
                if (sensorLowPower == lowPower) return;
                sensorLowPower = lowPower;
                if (!hardwareSensorsPaused) {
                    startHardwareSensors();
                    startLocationUpdates();
                }
            });
        }

        /** One timestamped JSON snapshot of all hardware readings available now. */
        @JavascriptInterface
        public String sensorSnapshot() {
            return hardwareSnapshotJson();
        }

        /** Compatibility stub: local model code is not distributed in this build. */
        @JavascriptInterface
        public String localVisionStatus() {
            return "{\"available\":false,\"ready\":false,\"state\":\"not_in_community_build\"}";
        }

        /** Compatibility stub retained for older saved UI state. */
        @JavascriptInterface
        public void downloadLocalVision() {
        }

        @JavascriptInterface
        public void pauseLocalVisionDownload() {
        }

        @JavascriptInterface
        public void removeLocalVisionModel() {
        }

        /** Compatibility stub retained for older saved UI state. */
        @JavascriptInterface
        public void inferLocalVision(final String requestId, final String dataUrl,
                                     final String prompt) {
            toJs("onLocalVisionStatus",
                    "{\"available\":false,\"ready\":false,\"state\":\"not_in_community_build\"}");
        }

        @JavascriptInterface
        public void cancelLocalVisionInference() {
        }

        @JavascriptInterface
        public boolean appToolsAllowed() {
            return appToolsAllowedValue();
        }

        @JavascriptInterface
        public void setAppToolsAllowed(final boolean allowed) {
            saveAppToolsAllowed(allowed);
        }

        @JavascriptInterface
        public String appCapabilities() {
            return appCapabilitiesJson();
        }

        @JavascriptInterface
        public String performAppAction(final String action, final String payload) {
            return externalAppAction(action, payload);
        }

        @JavascriptInterface
        public void webSearch(final String requestId, final String query) {
            new Thread(() -> {
                try { sendInternetResult(requestId, "search", webSearchJson(query), null); }
                catch (Exception e) { sendInternetResult(requestId, "search", null, e); }
            }, "owlbot-web-search").start();
        }

        @JavascriptInterface
        public void newsSearch(final String requestId, final String query) {
            new Thread(() -> {
                try { sendInternetResult(requestId, "news", newsSearchJson(query), null); }
                catch (Exception e) { sendInternetResult(requestId, "news", null, e); }
            }, "owlbot-news-search").start();
        }

        @JavascriptInterface
        public void weatherAt(final String requestId, final double latitude,
                              final double longitude) {
            new Thread(() -> {
                try { sendInternetResult(requestId, "weather", weatherJson(latitude, longitude), null); }
                catch (Exception e) { sendInternetResult(requestId, "weather", null, e); }
            }, "owlbot-weather").start();
        }

        /**
         * Offline face location for the WebView. The bundled ML Kit detector
         * supplies a real face crop when Chromium omits the Shape Detection
         * API. It performs no identification and sends no pixels off-device.
         */
        @JavascriptInterface
        public String detectFace(final String dataUrl) {
            JSONObject out = new JSONObject();
            Bitmap decoded = null;
            try {
                if (dataUrl == null || dataUrl.length() > 500_000) {
                    out.put("found", false);
                    return out.toString();
                }
                int comma = dataUrl.indexOf(',');
                String payload = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
                byte[] jpeg = Base64.decode(payload, Base64.DEFAULT);
                decoded = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
                if (decoded == null || decoded.getWidth() < 2 || decoded.getHeight() < 2) {
                    out.put("found", false);
                    return out.toString();
                }
                List<Face> faces = Tasks.await(
                        localFaceDetector.process(InputImage.fromBitmap(decoded, 0)),
                        2, TimeUnit.SECONDS);
                if (faces == null || faces.isEmpty()) {
                    out.put("found", false);
                    return out.toString();
                }
                Face face = faces.get(0);
                android.graphics.Rect box = face.getBoundingBox();
                float left = Math.max(0f, box.left);
                float top = Math.max(0f, box.top);
                float right = Math.min(decoded.getWidth(), box.right);
                float bottom = Math.min(decoded.getHeight(), box.bottom);
                out.put("found", true);
                out.put("x", left / decoded.getWidth());
                out.put("y", top / decoded.getHeight());
                out.put("width", (right - left) / decoded.getWidth());
                out.put("height", (bottom - top) / decoded.getHeight());
                out.put("confidence", 1.0);
                FaceLandmark leftEye = face.getLandmark(FaceLandmark.LEFT_EYE);
                FaceLandmark rightEye = face.getLandmark(FaceLandmark.RIGHT_EYE);
                if (leftEye != null && rightEye != null) {
                    out.put("leftEyeX", leftEye.getPosition().x / decoded.getWidth());
                    out.put("leftEyeY", leftEye.getPosition().y / decoded.getHeight());
                    out.put("rightEyeX", rightEye.getPosition().x / decoded.getWidth());
                    out.put("rightEyeY", rightEye.getPosition().y / decoded.getHeight());
                }
                return out.toString();
            } catch (Exception e) {
                try { out.put("found", false); } catch (Exception ignored) {}
                return out.toString();
            } finally {
                if (decoded != null && !decoded.isRecycled()) decoded.recycle();
            }
        }

        @JavascriptInterface
        public void vibrate(final int ms) {
            main.post(() -> {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                int duration = Math.max(1, Math.min(1500, ms));
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createOneShot(
                            duration, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    v.vibrate(duration);
                }
            });
        }

        @JavascriptInterface
        public void vibratePattern(final String pattern, final int requestedStrength) {
            main.post(() -> {
                Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
                if (v == null || !v.hasVibrator()) return;
                int strength = Math.max(1, Math.min(255, requestedStrength));
                long[] timings;
                int[] amplitudes;
                String name = pattern == null ? "tap" : pattern;
                if ("double".equals(name)) {
                    timings = new long[] {0, 70, 90, 70};
                    amplitudes = new int[] {0, strength, 0, strength};
                } else if ("pulse".equals(name)) {
                    timings = new long[] {0, 55, 55, 85, 55, 120};
                    amplitudes = new int[] {0, strength / 2, 0, strength * 3 / 4, 0, strength};
                } else if ("alert".equals(name)) {
                    timings = new long[] {0, 180, 90, 180};
                    amplitudes = new int[] {0, strength, 0, strength};
                } else {
                    timings = new long[] {0, 65};
                    amplitudes = new int[] {0, strength};
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(timings, amplitudes, -1));
                } else {
                    v.vibrate(timings, -1);
                }
            });
        }

        /**
         * The phone's own IPv4 on the Wi-Fi it is joined to. The body is
         * almost always on the same /24, which turns "what is my robot's IP"
         * from a router-admin trip into a hint the app can print.
         */
        @JavascriptInterface
        public String wifiIp() {
            try {
                WifiManager wm = (WifiManager) getApplicationContext()
                        .getSystemService(Context.WIFI_SERVICE);
                if (wm == null) return "";
                int ip = wm.getConnectionInfo().getIpAddress();
                if (ip == 0) return "";
                return String.format(Locale.US, "%d.%d.%d.%d",
                        ip & 0xff, (ip >> 8) & 0xff, (ip >> 16) & 0xff, (ip >> 24) & 0xff);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }

        @JavascriptInterface
        public String platform() {
            return "android-" + Build.VERSION.SDK_INT + " " + Build.MODEL;
        }
    }

    // --------------------------------------------------------------- speech

    private void startListening() {
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            pendingSpeechListen = true;
            askForSenses(false, true);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            toJs("onNativeSpeechError", "recognition unavailable on this device");
            return;
        }
        if (micPaused) return;
        if (listening) return;

        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onResults(Bundle b) {
                    listening = false;
                    ArrayList<String> hits =
                            b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (hits != null && !hits.isEmpty() && !hits.get(0).trim().isEmpty()) {
                        Log.i(TAG, "push-to-talk transcript ready");
                        toJs("onNativeSpeech", hits.get(0));
                    }
                    toJs("onNativeMicState", "idle");
                }
                @Override public void onError(int err) {
                    listening = false;
                    // No-match and timeout are the normal sound of a quiet
                    // room, not failures. Only surface the real problems.
                    boolean routine = (err == SpeechRecognizer.ERROR_NO_MATCH
                            || err == SpeechRecognizer.ERROR_SPEECH_TIMEOUT);
                    if (!routine) toJs("onNativeSpeechError", "error " + err);
                    toJs("onNativeMicState", "idle");
                }
                @Override public void onReadyForSpeech(Bundle b) {
                    toJs("onNativeMicState", "ready");
                }
                @Override public void onBeginningOfSpeech() {
                    toJs("onNativeMicState", "speech");
                }
                @Override public void onRmsChanged(float rms) {
                    // Roughly -2 (silence) to 10 (loud). Throttle to ~15 Hz:
                    // this is the creature's live sense of hearing, and it
                    // drives the face even while it is recognising.
                    long t = System.currentTimeMillis();
                    if (t - lastRms < 66) return;
                    lastRms = t;
                    // Swallow the first moment of a session. The recogniser's
                    // own start-up tone lands here and reads as a loud noise.
                    if (t - sessionStart < 900) return;
                    float n = Math.max(0f, Math.min(1f, (rms + 2f) / 12f));
                    toJs("onNativeMicLevel", String.valueOf(n));
                }
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() {
                    toJs("onNativeMicState", "thinking");
                }
                @Override public void onPartialResults(Bundle b) {
                    ArrayList<String> hits =
                            b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (hits != null && !hits.isEmpty()) {
                        toJs("onNativePartial", hits.get(0));
                    }
                }
                @Override public void onEvent(int t, Bundle b) {}
            });
        }

        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        // Endpoint slowly. The first version cut off after 900 ms of silence,
        // which meant the recogniser stopped and restarted every couple of
        // seconds all day: audible on Samsung (each session start plays a
        // tone), visible as the mic indicator flickering, and worst of all the
        // creature heard its own restart tone as a loud noise and said "eek".
        // Longer windows mean far fewer sessions and a mic that just stays on.
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2200L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2200L);
        i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L);
        // NOT EXTRA_PREFER_OFFLINE. It sounds ideal - no round trip, no chime,
        // works without internet - but if the device has no offline language
        // pack downloaded the recogniser fails immediately with ERROR_CLIENT
        // and never hears a word. Observed doing exactly that on this phone.
        if (Build.VERSION.SDK_INT >= 33) {
            i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING,
                    RecognizerIntent.FORMATTING_OPTIMIZE_LATENCY);
        }
        try {
            recognizer.startListening(i);
            listening = true;
            sessionStart = System.currentTimeMillis();
        } catch (Exception e) {
            listening = false;
            Log.w(TAG, "startListening failed: " + e.getMessage());
        }
    }

    private void finishListening() {
        if (!listening || recognizer == null) return;
        try {
            recognizer.stopListening();
            toJs("onNativeMicState", "thinking");
        } catch (Exception e) {
            listening = false;
            Log.w(TAG, "finishListening failed: " + e.getMessage());
        }
    }

    private void stopListening() {
        listening = false;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
        }
        toJs("onNativeMicState", micPaused ? "paused" : "idle");
    }

    private void toJs(String fn, String arg) {
        final String js = "if(window." + fn + ")window." + fn + "("
                + org.json.JSONObject.quote(arg == null ? "" : arg) + ");";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    // ------------------------------------------------------------- lifecycle

    private void goImmersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    public void onWindowFocusChanged(boolean has) {
        super.onWindowFocusChanged(has);
        if (has) goImmersive();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (sensorManager != null) sensorManager.unregisterListener(this);
        stopLocationUpdates();
        // Backgrounded: stop holding the mic. It comes back in onResume.
        stopListening();
        // Never leave the legs driving because the user swiped away.
        if (web != null) {
            web.evaluateJavascript(
                    "try{if(typeof stopRun==='function')stopRun();"
                    + "if(typeof stopMind==='function')stopMind();"
                    + "if(window.MIND)MIND.motionArmed=false;"
                    + "if(typeof wsSend==='function')wsSend({t:'stop'});}catch(e){}", null);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!hardwareSensorsPaused) {
            startHardwareSensors();
            startLocationUpdates();
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        stopLocationUpdates();
        if (tts != null) { tts.stop(); tts.shutdown(); }
        if (recognizer != null) recognizer.destroy();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
