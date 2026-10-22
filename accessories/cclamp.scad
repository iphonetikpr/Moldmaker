// Moldmaker universal C-clamp. Print flat, PETG. M6 rod, no printed threads.
throat=80; depth=45; part="frame"; // frame | knob | pad | assembly
t=12; bar=14; nutAF=10+0.3; nutH=5.2; hole=6.6;
W=throat+2*bar;
module frame(){ difference(){
  linear_extrude(t) difference(){
    union(){ square([bar+depth,bar]); translate([0,W-bar]) square([bar+depth,bar]); square([bar,W]);
      translate([bar,bar]) difference(){square(8);translate([8,8])circle(8);}
      translate([bar,W-bar-8]) difference(){square(8);translate([8,0])circle(8);} }
  }
  // M6 clearance through top jaw (along -Y) + captive nut pocket
  translate([bar+depth-12,W+1,t/2]) rotate([90,0,0]) cylinder(d=hole,h=bar+2,$fn=32);
  translate([bar+depth-12,W-bar/2,t/2]) rotate([90,0,0]) rotate(30) cylinder(d=nutAF/cos(30),h=nutH,center=true,$fn=6);
  translate([bar+depth-12-nutAF/2,W-bar/2-nutH/2,t/2]) cube([nutAF,nutH,t]); // slide-in from top face
}}
module knob(){ difference(){ union(){ cylinder(d=36,h=12,$fn=12); }
  translate([0,0,-1]) cylinder(d=hole,h=20,$fn=32);
  translate([0,0,12-6]) cylinder(d=nutAF/cos(30),h=7,$fn=6);}}
module pad(){ difference(){ cylinder(d=24,h=6,$fn=64);
  translate([0,0,2]) cylinder(d=6.4,h=5,$fn=32);}
  for(a=[0:90:270]) rotate(a) translate([0,3.5,4]) cube([0.8,1.2,3],center=true); }
if(part=="frame") frame(); else if(part=="knob") knob(); else if(part=="pad") pad();
else { frame(); %translate([bar+depth-12-30,bar,-5]) cube([45,throat-5,22]);
  color("silver") translate([bar+depth-12,W+20,t/2]) rotate([90,0,0]) cylinder(d=6,h=bar+20+throat-10,$fn=24);
  color("orange") translate([bar+depth-12,W+20,t/2]) rotate([-90,0,0]) knob();
  color("green") translate([bar+depth-12,bar+5+6,t/2]) rotate([90,0,0]) pad(); }
