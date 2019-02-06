# MiReCo
Xiaomi GiTV Remote Control

## Description
This is a simple web based remote control for GiTV (Xiaomi with chinese interface) based android devices :
- Mi Box
- Mi Tv
- Mi Projectors

No need to install anything special on your controlled device, this website/webapp communicates with the GiTV internal web server to send events to your device.

Should be compatible with anything running a web browser (provided it's quite up to date):
- Android
- iPhone/iPad
- PC/Mac computer

It probably won't work on international firmwares such as Android Tv 8.x (but if it does, please keep me informed)

Depending on your device, you'll need to have one the the 2 services enabled for it to work (enabled by default) :
- com.duokan.airkan.tvbox (AirkanTvService)
- com.xiaomi.mitv.remotecontroller.service (RemoteControllerService)
So if you have disabled "bloatware" (using "pm uninstall ...." for example), please make sure these services are still installed/enabled.

## Usage:
* Go here http://mireco.hopto.org on your controller device (ie: smartphone)
* Just configure your device IP address and you're good to go
* Use the settings to configure :
 * 4 custom buttons with :
  * com.example.packagename : packagename of an app actually installed on your controlled device. The button will launch it.
  * HDMI1/HDMI2 : change source to HDMI1 / HDMI2 (please note that as of GiTV 1.3.97, HDMI3 is not supported by the GiTV server, thus it won't work until Xiaomi fixes it).
 * custom package for home button (if you installed a custom launcher but didn't disable the stock one, which is still bound to the home button)
 * background and buttons colors
* This app is compatible with webapp standard, so adding a shortcut from your smartphone browser to your launcher will use a special icon and remove the unneeded address bar. For example, on Chrome, with [this page](http://mireco.hopto.org) open, just go to the settings and select "add to homescreen".

## Known issues:
* As explained above, shortcuts won't work to change to HDMI3 (at least it doesn't work on GiTV 1.3.97, hopefully it'll be fixed by Xiaomi)
* "Vibrate on touch" setting won't work on iOs (until Apple adds support)
* Power button will only work to power off. Powering On by HTML isn't supported. On my hardware (Mi Laser Projector), wake on lan doesn't work either. For now, I haven't been able to find out how official Mi Remote app wakes the device up (it might be using mDNS, but it's not discovered by standard Bonjour apps). Please contact me if you know how it works.
* Please note that due to the html mixed content restriction, this page needs to be hosted on an HTTP (not HTTPS) server. This is actually the case on http://mireco.hopto.org. But if you want to host it elsewhere, keep that in mind.

## GiTV http API features/"documentation"
Here are a few commands that work fine on my hardware
* **`http://DEVICE_IP:6095/controller?action=getinstalledapp&count=999&changeIcon=1`** Returns a json containing the installed apps
* **`http://DEVICE_IP:6095/controller?action=keyevent&keycode=%s`**
Sends a keypress to the device.
Put a character as keycode to send it.
A few keywords can replace the keycode :
  * **power** : turns the device off
  * **up/down/left/right** : goes up/down/left/right
  * **enter** : validate/ok
  * **home** : returns to home screen
  * **back** : goes back
  * **menu** : opens option menu
  * **volumeup** : increases volume
  * **volumedown** : decreases volume
* **`http://DEVICE_IP:6095/controller?action=startapp&type=packagename&packagename=%s`**
Launches the 'packagename' app on the device
* **`http://DEVICE_IP:6095/controller?action=changesource&source=%s`**
Changes to source "HDMI1" or "HDMI2"
* **`http://DEVICE_IP:6095/general?action=getVolum`**
Returns a json containing the current volume

A few other commands exists, but they are specific to chinese apps or need internal signature and are not worth reversing.
