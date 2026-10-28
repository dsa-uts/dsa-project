// Find the greatest common divisor of the two integers, n and m.
int gcd_euclid(int n, int m)
{
  if (n < 0 || m < 0)
    return -1;
  int tmp;
  // let m be the smaller one
  if (n < m)
  {
    // swap n and m
    int tmp = n;
    n = m;
    m = tmp;
  }
  while (1)
  {
    if (m == 0)
      return n;

    n = n % m;
    // swap n and m
    int tmp = n;
    n = m;
    m = tmp;
  }
}
