package dev.owlbot.brain;

/** Local pitch-only analysis. An 80 ms window resolves low humming notes;
 * the old 20 ms window often confused a fundamental with its octave. This
 * class has no Android/network dependency and never stores recordings. */
final class PitchTracker {
    private final short[] window = new short[1280];
    private int used = 0;
    void append(short[] samples, int n) {
        int take = Math.min(n, window.length);
        int retained = Math.min(used, window.length - take);
        System.arraycopy(window, used - retained, window, 0, retained);
        System.arraycopy(samples, n - take, window, retained, take);
        used = retained + take;
    }
    double[] estimate(int rate) {
        if (used < window.length) return new double[]{0, 0, 0};
        double mean=0, energy=0;
        for(short x:window) mean+=x;
        mean/=used;
        double[] values=new double[used];
        for(int i=0;i<used;i++){values[i]=(window[i]-mean)/32768.;energy+=values[i]*values[i];}
        double rms=Math.sqrt(energy/used);
        if(rms<.012)return new double[]{0,0,rms};
        int min=rate/1000,max=rate/65;
        double[] correlation=new double[max+2];double best=0;
        for(int lag=min-1;lag<=max+1;lag++){
            double xy=0,xx=0,yy=0;
            for(int i=0;i<used-lag;i++){double x=values[i],y=values[i+lag];xy+=x*y;xx+=x*x;yy+=y*y;}
            correlation[lag]=xy/Math.sqrt(Math.max(1e-12,xx*yy));
            if(lag>=min&&lag<=max)best=Math.max(best,correlation[lag]);
        }
        if(best<.8)return new double[]{0,best,rms};
        // First strong local peak, not a larger peak at two/three periods.
        for(int lag=min;lag<=max;lag++){
            double c=correlation[lag];
            if(c>=Math.max(.8,best*.95)&&c>correlation[lag-1]&&c>=correlation[lag+1]){
                double divisor=correlation[lag-1]-2*c+correlation[lag+1];
                double offset=Math.abs(divisor)<1e-9?0:.5*(correlation[lag-1]-correlation[lag+1])/divisor;
                double hz=rate/(lag+Math.max(-.5,Math.min(.5,offset)));
                return new double[]{69+12*Math.log(hz/440)/Math.log(2),c,rms};
            }
        }
        return new double[]{0,0,rms};
    }
}
