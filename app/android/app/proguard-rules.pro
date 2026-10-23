# =============================================================================
# ElyWalk — règles R8 / ProGuard (build release)
# =============================================================================
# R8 est activé en release (voir app/build.gradle). Ces règles garantissent que
# rien de ce qui est appelé par réflexion (Capacitor, plugins natifs, AdMob,
# Firebase, widget) n'est renommé ou supprimé.
# =============================================================================

# --- Métadonnées utiles (stack traces lisibles dans la Play Console) ---------
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,RuntimeVisibleTypeAnnotations
-keepattributes AnnotationDefault
-keepattributes *Annotation*
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- Code applicatif ElyWalk (services, widget, receiver, plugins) -----------
# Petites classes : le coût est négligeable et cela sécurise les composants
# instanciés par le système (BootReceiver, ElyWalkWidget, StepCounterService,
# TrackingService) ainsi que les ponts @JavascriptInterface.
-keep class com.elysium.elywalk.** { *; }

# --- Capacitor ---------------------------------------------------------------
# Les règles officielles du plugin Capacitor sont fournies via
# `consumerProguardFiles` (capacitor/proguard-rules.pro). On les duplique ici
# pour ne dépendre d'aucune propagation de configuration.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin public class * {
    @com.getcapacitor.annotation.PermissionCallback <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod public <methods>;
}
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep public class * extends org.apache.cordova.* {
    public <methods>;
    public <fields>;
}

# WebView <-> JS
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- Google Mobile Ads / UMP -------------------------------------------------
# Champs accédés par réflexion (bundles de médiation, libellés de test).
-keep class com.google.android.gms.ads.** { *; }
-keep class com.google.android.gms.internal.ads.** { *; }
-keep class com.google.android.ump.** { *; }
-keep class com.google.ads.** { *; }
-dontwarn com.google.android.gms.ads.**

# --- Firebase / Google Play services ----------------------------------------
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.common.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Modèles sérialisés par Firestore (getters/setters, constructeurs vides).
-keepclassmembers class com.elysium.elywalk.** {
    <init>();
    <fields>;
}

# --- Sérialisation / annotations --------------------------------------------
-keep class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    !static !transient <fields>;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# --- Avertissements bénins (dépendances optionnelles) -----------------------
-dontwarn org.apache.commons.**
-dontwarn org.slf4j.**
-dontwarn org.bouncycastle.**
-dontwarn org.conscrypt.**
-dontwarn org.chromium.**
-dontwarn javax.annotation.**
-dontwarn kotlinx.coroutines.**
-dontwarn com.google.android.play.core.**
-ignorewarnings
