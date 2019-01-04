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

## Usage:
* Go here http://mireco.hopto.org on your controller device (ie: smartphone)
* Just configure your device IP address and you're good to go
* Use the settings to configure 4 custom buttons with :
 * com.example.packagename : packagename of an app actually installed on your controlled device. The button will launch it.
 * HDMI1/HDMI2 : change source to HDMI1 / HDMI2 (please note that as of GiTV 1.3.97, HDMI3 is not supported by the GiTV server, thus it won't work until Xiaomi fixes it).
* This app is compatible with webapp standard, so adding a shortcut from your smartphone browser to your launcher will use a special icon and remove the unneeded address bar. For example, on Chrome, with [this page](http://mireco.hopto.org) open, just go to the settings and select "add to homescreen".

Please note the due to the html mixed content restriction, this page needs to be hosted on an HTTP (not HTTPS) server. 
This is actually the case on http://mireco.hopto.org. But if you want to host it elsewhere, keep that in mind.
